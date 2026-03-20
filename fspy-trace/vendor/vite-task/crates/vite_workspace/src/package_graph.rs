//! Package graph with indexed lookups and filter resolution.
//!
//! This module owns the `IndexedPackageGraph` (the read-only package dependency
//! graph enriched with hash-map indices for O(1) lookups) and the `PackageQuery`
//! type that expresses which packages a task query applies to.
//!
//! # Two-stage model
//!
//! Package selection (this module) is deliberately decoupled from task matching
//! (the task-query layer in `vite_task_graph`). `resolve_query` returns a *package
//! subgraph* — a `DiGraphMap<PackageNodeIndex, ()>` containing only the selected
//! packages and the original dependency edges between them. The task-query layer
//! then maps each selected package to its task node, reconnecting across
//! task-lacking nodes.

use std::sync::Arc;

use petgraph::{Direction, graph::DiGraph, prelude::DiGraphMap, visit::EdgeRef};
use rustc_hash::{FxHashMap, FxHashSet};
use vec1::{Vec1, smallvec_v1::SmallVec1};
use vite_path::AbsolutePath;
use vite_str::Str;

use crate::{
    DependencyType, PackageInfo, PackageIx, PackageNodeIndex,
    package_filter::{
        DirectoryPattern, GraphTraversal, PackageFilter, PackageNamePattern, PackageSelector,
        TraversalDirection,
    },
};

// ────────────────────────────────────────────────────────────────────────────
// PackageQuery
// ────────────────────────────────────────────────────────────────────────────

/// Specifies which packages a task query applies to.
///
/// This type is opaque — construct it via [`PackageQueryArgs::into_package_query`]
/// (from `package_filter`).
///
/// [`PackageQueryArgs::into_package_query`]: crate::package_filter::PackageQueryArgs::into_package_query
#[derive(Debug, PartialEq)]
pub struct PackageQuery(pub(crate) PackageQueryKind);

#[derive(Debug, PartialEq)]
pub(crate) enum PackageQueryKind {
    /// One or more `--filter` expressions.
    ///
    /// Inclusions are unioned; exclusions are subtracted from the union.
    /// If all filters are exclusions, the starting set is the full workspace
    /// pnpm ref: <https://github.com/pnpm/pnpm/blob/491a84fb26fa716408bf6bd361680f6a450c61fc/workspace/filter-workspace-packages/src/index.ts#L167-L168>
    Filters(Vec1<PackageFilter>),

    /// All packages in the workspace, in topological dependency order.
    ///
    /// Produced by `--recursive` / `-r`.
    All,
}

impl PackageQuery {
    /// All packages in the workspace.
    pub(crate) const fn all() -> Self {
        Self(PackageQueryKind::All)
    }

    /// One or more filter expressions.
    pub(crate) const fn filters(filters: Vec1<PackageFilter>) -> Self {
        Self(PackageQueryKind::Filters(filters))
    }

    /// Select the single package whose root is `path`.
    ///
    /// Used by the interactive task selector to match by filesystem path
    /// instead of package name.
    #[must_use]
    pub fn containing_package(path: Arc<AbsolutePath>) -> Self {
        Self(PackageQueryKind::Filters(Vec1::new(PackageFilter {
            exclude: false,
            selector: PackageSelector::ContainingPackage(path),
            traversal: None,
            source: None,
        })))
    }
}

// ────────────────────────────────────────────────────────────────────────────
// FilterResolution
// ────────────────────────────────────────────────────────────────────────────

/// The result of resolving a [`PackageQuery`] against the workspace.
pub struct FilterResolution {
    /// Induced package subgraph: nodes = selected packages, edges = original dependency
    /// ordering edges between them.
    ///
    /// All original edges between selected packages are preserved regardless of how each
    /// package was selected (traversal or cherry-pick). A cherry-picked package still
    /// respects its dependencies if they happen to be in the selected set.
    ///
    /// Future `--filter-prod` support would skip `DependencyType::Dev` edges at this
    /// stage (construction time), keeping all downstream code edge-type-agnostic.
    pub package_subgraph: DiGraphMap<PackageNodeIndex, ()>,

    /// Original `--filter` strings for inclusion selectors that matched no packages.
    ///
    /// Omits synthetic filters (implicit cwd, `-w`) since the user didn't type them.
    /// Empty when `PackageQuery::All` is used.
    pub unmatched_selectors: Vec<Str>,
}

// ────────────────────────────────────────────────────────────────────────────
// PackageQueryResolveError
// ────────────────────────────────────────────────────────────────────────────

/// Errors that can occur when resolving a [`PackageQuery`] against the workspace.
#[derive(Debug, thiserror::Error)]
pub enum PackageQueryResolveError {
    #[error(
        "Package name '{package_name}' is ambiguous; found in multiple locations: {}",
        package_paths.iter().map(|p| p.as_path().display().to_string()).collect::<Vec<_>>().join(", ")
    )]
    AmbiguousPackageName { package_name: Str, package_paths: Box<[Arc<AbsolutePath>]> },
}

// ────────────────────────────────────────────────────────────────────────────
// IndexedPackageGraph
// ────────────────────────────────────────────────────────────────────────────

/// Package graph with additional hash maps for quick task lookup.
#[derive(Debug)]
pub struct IndexedPackageGraph {
    graph: DiGraph<PackageInfo, DependencyType, PackageIx>,

    /// Package indices grouped by name.
    ///
    /// `SmallVec1` avoids a heap allocation in the common case (one package per name)
    /// while still supporting the rare monorepo name-collision scenario.
    indices_by_name: FxHashMap<Str, SmallVec1<[PackageNodeIndex; 1]>>,

    /// Package indices by absolute path, for O(1) lookup given a cwd.
    indices_by_path: FxHashMap<Arc<AbsolutePath>, PackageNodeIndex>,
}

impl IndexedPackageGraph {
    /// Build the index from a raw package graph.
    #[must_use]
    pub fn index(package_graph: DiGraph<PackageInfo, DependencyType, PackageIx>) -> Self {
        let indices_by_path: FxHashMap<Arc<AbsolutePath>, PackageNodeIndex> = package_graph
            .node_indices()
            .map(|idx| (Arc::clone(&package_graph[idx].absolute_path), idx))
            .collect();

        let mut indices_by_name: FxHashMap<Str, SmallVec1<[PackageNodeIndex; 1]>> =
            FxHashMap::default();
        for idx in package_graph.node_indices() {
            let name = package_graph[idx].package_json.name.clone();
            indices_by_name
                .entry(name)
                .and_modify(|v| v.push(idx))
                .or_insert_with(|| SmallVec1::new(idx));
        }

        Self { graph: package_graph, indices_by_name, indices_by_path }
    }

    // ── Public accessors ─────────────────────────────────────────────────────

    /// Reference to the underlying package graph.
    #[must_use]
    pub const fn package_graph(&self) -> &DiGraph<PackageInfo, DependencyType, PackageIx> {
        &self.graph
    }

    /// Walk up the directory tree from `cwd` to find the nearest enclosing package.
    ///
    /// Returns `None` if no package root is found anywhere above `cwd`.
    #[must_use]
    pub fn get_package_index_from_cwd(&self, cwd: &AbsolutePath) -> Option<PackageNodeIndex> {
        let mut cur = cwd;
        loop {
            if let Some(&idx) = self.indices_by_path.get(cur) {
                return Some(idx);
            }
            cur = cur.parent()?;
        }
    }

    /// Look up all package indices with the given name (exact, case-sensitive).
    #[must_use]
    pub fn get_package_indices_by_name(
        &self,
        name: &Str,
    ) -> Option<&SmallVec1<[PackageNodeIndex; 1]>> {
        self.indices_by_name.get(name)
    }

    // ── Query resolution ─────────────────────────────────────────────────────

    /// Resolve a [`PackageQuery`] into a [`FilterResolution`].
    ///
    /// For `All`, returns the full induced subgraph (every package, every edge).
    /// For `Filters`, applies the filter algorithm and returns the induced subgraph
    /// of the matching packages.
    ///
    /// # Errors
    ///
    /// Returns [`PackageQueryResolveError::AmbiguousPackageName`] when an exact
    /// package name (from a `pkg#task` specifier) matches multiple packages.
    pub fn resolve_query(
        &self,
        query: &PackageQuery,
    ) -> Result<FilterResolution, PackageQueryResolveError> {
        match &query.0 {
            PackageQueryKind::All => Ok(FilterResolution {
                package_subgraph: self.full_subgraph(),
                unmatched_selectors: Vec::new(),
            }),
            PackageQueryKind::Filters(filters) => self.resolve_filters(filters.as_slice()),
        }
    }

    /// Build the full induced subgraph: every package node and every dependency edge.
    ///
    /// Used by `PackageQuery::All` (`--recursive`).
    fn full_subgraph(&self) -> DiGraphMap<PackageNodeIndex, ()> {
        let mut subgraph = DiGraphMap::new();
        for idx in self.graph.node_indices() {
            subgraph.add_node(idx);
        }
        for edge in self.graph.edge_references() {
            subgraph.add_edge(edge.source(), edge.target(), ());
        }
        subgraph
    }

    /// Resolve a slice of package filters into a `FilterResolution`.
    ///
    /// # Algorithm (follows pnpm's [`filterWorkspacePackages`])
    ///
    /// [`filterWorkspacePackages`]: https://github.com/pnpm/pnpm/blob/491a84fb26fa716408bf6bd361680f6a450c61fc/workspace/filter-workspace-packages/src/index.ts#L149-L178
    ///
    /// 1. Partition filters into inclusions (`!exclude = false`) and exclusions.
    /// 2. If there are no inclusions, start from ALL packages (exclude-only mode).
    /// 3. For each inclusion: resolve its selector to entry packages, expand via
    ///    graph traversal if requested, and union into `selected`.
    /// 4. For each exclusion: resolve + expand, then subtract from `selected`.
    /// 5. Build the induced subgraph: every original edge whose both endpoints are
    ///    in `selected` is preserved, regardless of how each endpoint was selected.
    fn resolve_filters(
        &self,
        filters: &[PackageFilter],
    ) -> Result<FilterResolution, PackageQueryResolveError> {
        let mut unmatched_selectors = Vec::new();

        let (inclusions, exclusions): (Vec<_>, Vec<_>) = filters.iter().partition(|f| !f.exclude);

        // Start from all packages when there are no inclusions (exclude-only mode).
        let mut selected: FxHashSet<PackageNodeIndex> = if inclusions.is_empty() {
            self.graph.node_indices().collect()
        } else {
            FxHashSet::default()
        };

        // Apply inclusions: union each filter's resolved set into `selected`.
        for filter in &inclusions {
            let matched = self.resolve_selector_entries(&filter.selector)?;
            if matched.is_empty()
                && let Some(source) = &filter.source
            {
                unmatched_selectors.push(source.clone());
            }
            let expanded = self.expand_traversal(matched, filter.traversal.as_ref());
            selected.extend(expanded);
        }

        // Apply exclusions: subtract each filter's resolved set from `selected`.
        for filter in &exclusions {
            let matched = self.resolve_selector_entries(&filter.selector)?;
            let to_remove = self.expand_traversal(matched, filter.traversal.as_ref());
            for pkg in to_remove {
                selected.remove(&pkg);
            }
        }

        let package_subgraph = self.build_induced_subgraph(&selected);
        Ok(FilterResolution { package_subgraph, unmatched_selectors })
    }

    /// Resolve a `PackageSelector` to the set of directly matched packages
    /// (before any graph traversal expansion).
    fn resolve_selector_entries(
        &self,
        selector: &PackageSelector,
    ) -> Result<FxHashSet<PackageNodeIndex>, PackageQueryResolveError> {
        let mut matched = FxHashSet::default();

        match selector {
            PackageSelector::Name(pattern) => {
                self.match_by_name_pattern(pattern, &mut matched)?;
            }

            PackageSelector::Directory(dir_pattern) => {
                self.match_by_directory_pattern(dir_pattern, &mut matched);
            }

            PackageSelector::ContainingPackage(path) => {
                // Walk up the directory tree to find the enclosing package.
                if let Some(idx) = self.get_package_index_from_cwd(path) {
                    matched.insert(idx);
                }
            }

            PackageSelector::NameAndDirectory { name, directory } => {
                // Intersection: packages satisfying both name AND directory.
                let mut by_name = FxHashSet::default();
                self.match_by_name_pattern(name, &mut by_name)?;
                let mut by_dir = FxHashSet::default();
                self.match_by_directory_pattern(directory, &mut by_dir);
                matched.extend(by_name.intersection(&by_dir));
            }

            PackageSelector::WorkspaceRoot => {
                // The workspace root package has an empty relative path.
                for idx in self.graph.node_indices() {
                    if self.graph[idx].path.as_str().is_empty() {
                        matched.insert(idx);
                        break;
                    }
                }
            }
        }

        Ok(matched)
    }

    /// Match packages by a name pattern, inserting into `out`.
    ///
    /// For `Exact` names, scoped auto-completion applies
    /// (pnpm ref: <https://github.com/pnpm/pnpm/blob/491a84fb26fa716408bf6bd361680f6a450c61fc/workspace/filter-workspace-packages/src/index.ts#L303-L306>):
    /// if `"bar"` has no exact match but exactly one `@*/bar` package exists,
    /// that package is used instead.
    fn match_by_name_pattern(
        &self,
        pattern: &PackageNamePattern,
        out: &mut FxHashSet<PackageNodeIndex>,
    ) -> Result<(), PackageQueryResolveError> {
        match pattern {
            PackageNamePattern::Exact { name, unique } => {
                if let Some(indices) = self.get_package_indices_by_name(name) {
                    if *unique && indices.len() > 1 {
                        return Err(PackageQueryResolveError::AmbiguousPackageName {
                            package_name: name.clone(),
                            package_paths: indices
                                .iter()
                                .map(|i| Arc::clone(&self.graph[*i].absolute_path))
                                .collect(),
                        });
                    }
                    out.extend(indices.iter().copied());
                } else {
                    // Scoped auto-completion: `"bar"` → `"@scope/bar"` if exactly one match.
                    let scoped_suffix = vite_str::format!("/{}", name);
                    let scoped: Vec<_> = self
                        .indices_by_name
                        .iter()
                        .filter(|(pkg_name, _)| {
                            pkg_name.starts_with('@') && pkg_name.ends_with(scoped_suffix.as_str())
                        })
                        .flat_map(|(_, indices)| indices.iter().copied())
                        .collect();
                    if scoped.len() == 1 {
                        out.insert(scoped[0]);
                    }
                    // 0 matches: nothing to insert.
                    // >1 matches: ambiguous; skip rather than guessing wrong.
                }
            }

            PackageNamePattern::Glob(glob) => {
                use wax::Program as _;
                for (pkg_name, indices) in &self.indices_by_name {
                    if glob.is_match(pkg_name.as_str()) {
                        out.extend(indices.iter().copied());
                    }
                }
            }
        }
        Ok(())
    }

    /// Match packages by a directory pattern, inserting into `out`.
    ///
    /// pnpm ref: <https://github.com/pnpm/pnpm/blob/491a84fb26fa716408bf6bd361680f6a450c61fc/workspace/filter-workspace-packages/src/index.ts#L317-L324>
    fn match_by_directory_pattern(
        &self,
        pattern: &DirectoryPattern,
        out: &mut FxHashSet<PackageNodeIndex>,
    ) {
        match pattern {
            DirectoryPattern::Exact(dir) => {
                // O(1) exact lookup by path.
                if let Some(&idx) = self.indices_by_path.get(dir) {
                    out.insert(idx);
                }
            }
            DirectoryPattern::Glob { base, pattern } => {
                use wax::Program as _;
                for idx in self.graph.node_indices() {
                    let pkg_path = &self.graph[idx].absolute_path;
                    if let Ok(remainder) = pkg_path.as_path().strip_prefix(base.as_path())
                        && pattern.is_match(remainder)
                    {
                        out.insert(idx);
                    }
                }
            }
        }
    }

    /// Expand a seed set of packages according to a graph traversal specification.
    ///
    /// Returns the final set, including or excluding the original seeds depending on
    /// `traversal.exclude_self`. `None` traversal → seeds returned unchanged.
    fn expand_traversal(
        &self,
        seeds: FxHashSet<PackageNodeIndex>,
        traversal: Option<&GraphTraversal>,
    ) -> FxHashSet<PackageNodeIndex> {
        let Some(traversal) = traversal else {
            return seeds;
        };

        let mut reachable = FxHashSet::default();

        match traversal.direction {
            TraversalDirection::Dependencies => {
                self.bfs_outgoing(&seeds, &mut reachable);
            }
            TraversalDirection::Dependents => {
                self.bfs_incoming(&seeds, &mut reachable);
            }
            TraversalDirection::Both => {
                // Walk dependents first, then walk dependencies of ALL dependents found
                // (including the original seeds).
                // pnpm ref: <https://github.com/pnpm/pnpm/blob/491a84fb26fa716408bf6bd361680f6a450c61fc/workspace/filter-workspace-packages/src/index.ts#L265-L267>
                let mut dependents = FxHashSet::default();
                self.bfs_incoming(&seeds, &mut dependents);
                let all_dep_seeds: FxHashSet<_> =
                    seeds.iter().chain(dependents.iter()).copied().collect();
                self.bfs_outgoing(&all_dep_seeds, &mut reachable);
                reachable.extend(dependents);
            }
        }

        if traversal.exclude_self {
            for seed in &seeds {
                reachable.remove(seed);
            }
        } else {
            reachable.extend(seeds);
        }

        reachable
    }

    /// BFS along outgoing (dependency) edges from `seeds`, collecting all reachable nodes.
    ///
    /// Seeds are NOT added to `out`; the caller decides inclusion based on `exclude_self`.
    fn bfs_outgoing(
        &self,
        seeds: &FxHashSet<PackageNodeIndex>,
        out: &mut FxHashSet<PackageNodeIndex>,
    ) {
        let mut queue: Vec<PackageNodeIndex> = seeds.iter().copied().collect();
        while let Some(node) = queue.pop() {
            for edge in self.graph.edges(node) {
                let dep = edge.target();
                if out.insert(dep) {
                    queue.push(dep);
                }
            }
        }
    }

    /// BFS along incoming (dependent) edges from `seeds`, collecting all reachable nodes.
    ///
    /// Seeds are NOT added to `out`.
    fn bfs_incoming(
        &self,
        seeds: &FxHashSet<PackageNodeIndex>,
        out: &mut FxHashSet<PackageNodeIndex>,
    ) {
        let mut queue: Vec<PackageNodeIndex> = seeds.iter().copied().collect();
        while let Some(node) = queue.pop() {
            for edge in self.graph.edges_directed(node, Direction::Incoming) {
                let dependent = edge.source();
                if out.insert(dependent) {
                    queue.push(dependent);
                }
            }
        }
    }

    /// Build the induced subgraph of `selected` packages.
    ///
    /// Includes every node in `selected` and every original edge `(a, b)` where
    /// both `a` and `b` are in `selected`. Isolated nodes are also included.
    fn build_induced_subgraph(
        &self,
        selected: &FxHashSet<PackageNodeIndex>,
    ) -> DiGraphMap<PackageNodeIndex, ()> {
        let mut subgraph = DiGraphMap::new();
        for &pkg in selected {
            subgraph.add_node(pkg);
        }
        for edge in self.graph.edge_references() {
            let src = edge.source();
            let dst = edge.target();
            if selected.contains(&src) && selected.contains(&dst) {
                subgraph.add_edge(src, dst, ());
            }
        }
        subgraph
    }
}
