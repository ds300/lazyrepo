//! Task query: map a `PackageQuery` to a `TaskExecutionGraph`.
//!
//! # Two-stage model
//!
//! Stage 1 — package selection — is handled by `IndexedPackageGraph::resolve_query`
//! and produces a `DiGraphMap<PackageNodeIndex, ()>` (the *package subgraph*).
//!
//! Stage 2 — task mapping — is handled by `map_subgraph_to_tasks`:
//! - Packages that **have** the requested task are mapped to their `TaskNodeIndex`.
//! - Packages that **lack** the task are *reconnected*: each predecessor is wired
//!   directly to each successor, then the task-lacking node is removed. This preserves
//!   transitive ordering even when intermediate packages miss the task.
//!
//! After all task-lacking nodes have been removed, the remaining package subgraph
//! contains only task-having packages; edges map directly to task dependency edges.
//!
//! Explicit `dependsOn` dependencies are then added on top by `add_dependencies`.

use petgraph::{Direction, prelude::DiGraphMap, visit::EdgeRef};
use rustc_hash::{FxHashMap, FxHashSet};
use vite_str::Str;
use vite_workspace::PackageNodeIndex;
pub use vite_workspace::package_graph::{PackageQuery, PackageQueryResolveError};

use crate::{IndexedTaskGraph, TaskDependencyType, TaskId, TaskNodeIndex};

/// A task execution graph queried from a `TaskQuery`.
///
/// Nodes are `TaskNodeIndex` values into the full `TaskGraph`.
/// Edges represent the final dependency relationships between tasks (no weights).
pub type TaskExecutionGraph = DiGraphMap<TaskNodeIndex, ()>;

/// A query for which tasks to run.
///
/// A `TaskQuery` must be **self-contained**: it fully describes which tasks
/// will be selected, without relying on ambient state such as cwd or
/// environment variables. For example, the implicit cwd is captured as a
/// `ContainingPackage(path)` selector inside [`PackageQuery`], so two
/// queries from different directories compare as unequal even though the
/// user typed the same CLI arguments.
///
/// This property is essential for the **skip rule** in task planning, which
/// compares the nested query against the parent query with `==`. If any
/// external context leaked into the comparison (or was excluded from it),
/// the skip rule would either miss legitimate recursion or incorrectly
/// suppress distinct expansions.
#[derive(Debug, PartialEq)]
pub struct TaskQuery {
    /// Which packages to select.
    pub package_query: PackageQuery,

    /// The task name to run within each selected package.
    pub task_name: Str,

    /// Whether to include explicit `dependsOn` dependencies from `vite-task.json`.
    pub include_explicit_deps: bool,
}

/// The result of [`IndexedTaskGraph::query_tasks`].
#[derive(Debug)]
pub struct TaskQueryResult {
    /// The final execution graph for the selected tasks.
    ///
    /// May be empty if no selected packages have the requested task, or if no
    /// packages matched the filters. The caller uses `node_count() == 0` to
    /// decide whether to show task-not-found UI.
    pub execution_graph: TaskExecutionGraph,

    /// Original `--filter` strings for inclusion selectors that matched no packages.
    ///
    /// Omits synthetic filters (implicit cwd, `-w`) since the user didn't type them.
    /// Always empty when `PackageQuery::All` was used.
    pub unmatched_selectors: Vec<Str>,
}

impl IndexedTaskGraph {
    /// Query the task graph based on the given [`TaskQuery`].
    ///
    /// Returns a [`TaskQueryResult`] containing the execution graph and any
    /// unmatched selectors. The execution graph may be empty — the caller decides
    /// what to do in that case (show task selector, emit warnings, etc.).
    ///
    /// # Errors
    ///
    /// Returns [`PackageQueryResolveError::AmbiguousPackageName`] when an exact
    /// package name (from a `pkg#task` specifier) matches multiple packages.
    ///
    /// # Order of operations
    ///
    /// 1. Resolve `PackageQuery` → package subgraph (Stage 1).
    /// 2. Map package subgraph → task execution graph, reconnecting task-lacking
    ///    packages (Stage 2).
    /// 3. Expand explicit `dependsOn` edges (if `include_explicit_deps`).
    pub fn query_tasks(
        &self,
        query: &TaskQuery,
    ) -> Result<TaskQueryResult, PackageQueryResolveError> {
        let mut execution_graph = TaskExecutionGraph::default();

        // Stage 1: resolve package selection.
        let resolution = self.indexed_package_graph.resolve_query(&query.package_query)?;

        // Stage 2: map each selected package to its task node (with reconnection).
        self.map_subgraph_to_tasks(
            &resolution.package_subgraph,
            &query.task_name,
            &mut execution_graph,
        );

        // Expand explicit dependsOn edges (may add new task nodes from outside the subgraph).
        if query.include_explicit_deps {
            self.add_dependencies(&mut execution_graph, |_| TaskDependencyType::is_explicit());
        }

        Ok(TaskQueryResult { execution_graph, unmatched_selectors: resolution.unmatched_selectors })
    }

    /// Map a package subgraph to a task execution graph.
    ///
    /// For packages **with** the task: add the corresponding `TaskNodeIndex`.
    ///
    /// For packages **without** the task: wire each predecessor directly to each
    /// successor (skip-intermediate reconnection), then remove the node. Working on
    /// a *mutable clone* of the subgraph ensures that reconnected edges are visible
    /// when processing subsequent task-lacking nodes in the same pass — transitive
    /// task-lacking chains are resolved correctly regardless of iteration order.
    ///
    /// After all task-lacking nodes are removed, every remaining node in `subgraph`
    /// is guaranteed to be in `pkg_to_task`. The index operator panics on a missing
    /// key — a panic here indicates a bug in the reconnection loop above.
    fn map_subgraph_to_tasks(
        &self,
        package_subgraph: &DiGraphMap<PackageNodeIndex, ()>,
        task_name: &Str,
        execution_graph: &mut TaskExecutionGraph,
    ) {
        // Build the task-lookup map for all packages that have the requested task.
        let pkg_to_task: FxHashMap<PackageNodeIndex, TaskNodeIndex> = package_subgraph
            .nodes()
            .filter_map(|pkg| {
                self.node_indices_by_task_id
                    .get(&TaskId { package_index: pkg, task_name: task_name.clone() })
                    .map(|&task_idx| (pkg, task_idx))
            })
            .collect();

        // Clone the subgraph so that reconnection edits are visible in subsequent iterations.
        let mut subgraph = package_subgraph.clone();

        // Reconnect and remove each task-lacking node.
        for pkg in package_subgraph.nodes() {
            if pkg_to_task.contains_key(&pkg) {
                continue; // this package has the task — leave it in
            }
            // Read pred/succ from the live (possibly already-modified) subgraph.
            let preds: Vec<_> = subgraph.neighbors_directed(pkg, Direction::Incoming).collect();
            let succs: Vec<_> = subgraph.neighbors_directed(pkg, Direction::Outgoing).collect();
            // Bridge: every predecessor connects directly to every successor.
            for &pred in &preds {
                for &succ in &succs {
                    subgraph.add_edge(pred, succ, ());
                }
            }
            subgraph.remove_node(pkg);
        }

        // Map remaining nodes and their edges to task nodes.
        // Every node still in `subgraph` is in `pkg_to_task`; the index operator
        // panics on a missing key — that would be a bug in the loop above.
        for &task_idx in pkg_to_task.values() {
            execution_graph.add_node(task_idx);
        }
        for (src, dst, ()) in subgraph.all_edges() {
            let st = pkg_to_task[&src];
            let dt = pkg_to_task[&dst];
            execution_graph.add_edge(st, dt, ());
        }
    }

    /// Recursively add dependencies to the execution graph based on filtered edges.
    ///
    /// Starts from the current nodes in `execution_graph` and follows outgoing edges
    /// that match `filter_edge`, adding new nodes to the frontier until no new nodes
    /// are discovered.
    fn add_dependencies(
        &self,
        execution_graph: &mut TaskExecutionGraph,
        mut filter_edge: impl FnMut(TaskDependencyType) -> bool,
    ) {
        let mut frontier: FxHashSet<TaskNodeIndex> = execution_graph.nodes().collect();

        // Continue until no new nodes are added to the frontier.
        while !frontier.is_empty() {
            let mut next_frontier = FxHashSet::<TaskNodeIndex>::default();

            for from_node in frontier {
                for edge_ref in self.task_graph.edges(from_node) {
                    let to_node = edge_ref.target();
                    let dep_type = *edge_ref.weight();
                    if filter_edge(dep_type) {
                        let is_new = !execution_graph.contains_node(to_node);
                        execution_graph.add_edge(from_node, to_node, ());
                        if is_new {
                            next_frontier.insert(to_node);
                        }
                    }
                }
            }

            frontier = next_frontier;
        }
    }
}
