pub mod config;
pub mod display;
pub mod loader;
pub mod query;
mod specifier;

use std::{convert::Infallible, sync::Arc};

use config::{ResolvedGlobalCacheConfig, ResolvedTaskConfig, UserRunConfig};
use petgraph::graph::{DefaultIx, DiGraph, EdgeIndex, IndexType, NodeIndex};
use rustc_hash::{FxBuildHasher, FxHashMap};
use serde::Serialize;
pub use specifier::TaskSpecifier;
use vite_path::AbsolutePath;
use vite_str::Str;
use vite_workspace::{PackageNodeIndex, WorkspaceRoot, package_graph::IndexedPackageGraph};

use crate::display::TaskDisplay;

/// The type of a task dependency edge in the task graph.
///
/// Currently only `Explicit` is produced (from `dependsOn` in `vite-task.json`).
/// Topological ordering is handled at query time via the package subgraph rather
/// than by pre-computing edges in the task graph.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct TaskDependencyType;

impl TaskDependencyType {
    /// Returns `true` — all task graph edges are explicit `dependsOn` dependencies.
    ///
    /// Kept as an associated function for use as a filter predicate in
    /// `add_dependencies`. Always returns `true` since `TaskDependencyType`
    /// only represents explicit edges now.
    #[must_use]
    pub const fn is_explicit() -> bool {
        true
    }
}

/// Uniquely identifies a task, by its name and the package where it's defined.
#[derive(Debug, PartialEq, Eq, Hash, Clone, PartialOrd, Ord)]
pub(crate) struct TaskId {
    /// The index of the package where the task is defined.
    pub package_index: PackageNodeIndex,

    /// The name of the script or the entry in `vite.config.*`.
    pub task_name: Str,
}

/// Whether a task originates from the `tasks` map or from a package.json script.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TaskSource {
    /// Defined in the `tasks` map in the workspace config.
    TaskConfig,
    /// Pure package.json script (not in the tasks map).
    PackageJsonScript,
}

/// A node in the task graph, representing a task with its resolved configuration.
#[derive(Debug, Serialize)]
pub struct TaskNode {
    /// Printing the task in a human-readable way.
    pub task_display: TaskDisplay,

    /// The resolved configuration of this task.
    ///
    /// This contains information affecting how the task is spawn,
    /// whereas `task_id` is for looking up the task.
    ///
    /// However, it does not contain external factors like additional args from cli and env vars.
    pub resolved_config: ResolvedTaskConfig,

    /// Whether this task comes from the tasks map or a package.json script.
    pub source: TaskSource,
}

impl vite_graph_ser::GetKey for TaskNode {
    type Key<'a> = (&'a AbsolutePath, &'a str);

    #[expect(clippy::disallowed_types, reason = "trait requires String as error type")]
    fn key(&self) -> Result<Self::Key<'_>, String> {
        Ok((&self.task_display.package_path, &self.task_display.task_name))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TaskGraphLoadError {
    #[error("Failed to load package graph")]
    PackageGraphLoadError(#[from] vite_workspace::Error),

    #[error("Failed to load task config file for package at {package_path:?}")]
    ConfigLoadError {
        package_path: Arc<AbsolutePath>,
        #[source]
        error: anyhow::Error,
    },

    #[error(
        "Task {task_display} conflicts with a package.json script of the same name. \
         Remove the script from package.json or rename the task"
    )]
    ScriptConflict { task_display: TaskDisplay },

    #[error("Failed to resolve task config for task {task_display}")]
    ResolveConfigError {
        task_display: TaskDisplay,
        #[source]
        error: crate::config::ResolveTaskConfigError,
    },

    #[error("Failed to lookup dependency '{specifier}' for task {task_display}")]
    DependencySpecifierLookupError {
        specifier: Str,
        task_display: TaskDisplay,
        #[source]
        error: SpecifierLookupError,
    },

    #[error("`cache` can only be set in the workspace root config, but found in {package_path}")]
    CacheInNonRootPackage { package_path: Arc<AbsolutePath> },

    #[error(
        "`enablePrePostScripts` can only be set in the workspace root config, but found in {package_path}"
    )]
    PrePostScriptsInNonRootPackage { package_path: Arc<AbsolutePath> },
}

/// Error when looking up a task by its specifier.
///
/// It's generic over `UnknownPackageError`, which is the error type when looking up a task without a package name and without a package origin.
///
/// - When the specifier is from `dependOn` of a known task, `UnknownPackageError` is `Infallible` because the origin package is always known.
/// - When the specifier is from a CLI command, `UnknownPackageError` can be a real error type in case cwd is not in any package.
#[derive(Debug, thiserror::Error, Serialize)]
pub enum SpecifierLookupError<PackageUnknownError = Infallible> {
    #[error("Package '{package_name}' is ambiguous among multiple packages: {package_paths:?}")]
    AmbiguousPackageName { package_name: Str, package_paths: Box<[Arc<AbsolutePath>]> },

    #[error("Package '{package_name}' not found")]
    PackageNameNotFound { package_name: Str },

    #[error("Task '{task_name}' not found in package {package_name}")]
    TaskNameNotFound {
        package_name: Str,
        task_name: Str,
        #[serde(skip)]
        package_index: PackageNodeIndex,
    },

    #[error(
        "Nowhere to look for task '{task_name}' because the package is unknown: {unspecifier_package_error}"
    )]
    PackageUnknown { unspecifier_package_error: PackageUnknownError, task_name: Str },
}

/// newtype of `DefaultIx` for indices in task graphs
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct TaskIx(DefaultIx);
// SAFETY: TaskIx is a newtype over DefaultIx which already implements IndexType correctly
unsafe impl IndexType for TaskIx {
    fn new(x: usize) -> Self {
        Self(DefaultIx::new(x))
    }

    fn index(&self) -> usize {
        self.0.index()
    }

    fn max() -> Self {
        Self(<DefaultIx as IndexType>::max())
    }
}

pub type TaskNodeIndex = NodeIndex<TaskIx>;
pub type TaskEdgeIndex = EdgeIndex<TaskIx>;

/// Full task graph of a workspace, with necessary hash maps for quick task lookup
///
/// It's immutable after created. The task nodes contain resolved task configurations and their dependencies.
/// External factors (e.g. additional args from cli, current working directory, environmental variables) are not stored here.
#[derive(Debug)]
pub struct IndexedTaskGraph {
    task_graph: DiGraph<TaskNode, TaskDependencyType, TaskIx>,

    /// Preserve the package graph for two purposes:
    /// - `self.task_graph` refers packages via `PackageNodeIndex`. To display package names and paths, we need to lookup them in `package_graph`.
    /// - To find nearest topological tasks when the starting package itself doesn't contain the task with the given name.
    indexed_package_graph: IndexedPackageGraph,

    /// task indices by task id for quick lookup
    pub(crate) node_indices_by_task_id: FxHashMap<TaskId, TaskNodeIndex>,

    /// Reverse map: task node index → task id (for hook lookup)
    task_ids_by_node_index: FxHashMap<TaskNodeIndex, TaskId>,

    /// Global cache configuration resolved from the workspace root config.
    resolved_global_cache: ResolvedGlobalCacheConfig,

    /// Whether pre/post script hooks are enabled (from `enablePrePostScripts` in workspace root config).
    pre_post_scripts_enabled: bool,
}

pub type TaskGraph = DiGraph<TaskNode, TaskDependencyType, TaskIx>;

impl IndexedTaskGraph {
    /// Load the task graph from a discovered workspace using the provided config loader.
    ///
    /// # Errors
    ///
    /// Returns [`TaskGraphLoadError`] if the package graph fails to load, a config file
    /// cannot be read, a task config cannot be resolved, a dependency specifier is invalid,
    /// or `cache` is set in a non-root package.
    #[tracing::instrument(level = "debug", skip_all)]
    #[expect(
        clippy::too_many_lines,
        reason = "graph loading is inherently sequential and multi-step"
    )]
    pub async fn load(
        workspace_root: &WorkspaceRoot,
        config_loader: &dyn loader::UserConfigLoader,
    ) -> Result<Self, TaskGraphLoadError> {
        let mut task_graph = DiGraph::<TaskNode, TaskDependencyType, TaskIx>::default();

        let package_graph = vite_workspace::load_package_graph(workspace_root)?;

        // Record dependency specifiers for each task node to add explicit dependencies later
        let mut task_ids_with_dependency_specifiers: Vec<(TaskId, Option<Arc<[Str]>>)> = Vec::new();

        // index tasks by ids
        let mut node_indices_by_task_id: FxHashMap<TaskId, TaskNodeIndex> =
            FxHashMap::with_capacity_and_hasher(task_graph.node_count(), FxBuildHasher);
        let mut task_ids_by_node_index: FxHashMap<TaskNodeIndex, TaskId> =
            FxHashMap::with_capacity_and_hasher(task_graph.node_count(), FxBuildHasher);

        // First pass: load all configs, extract root cache config, validate
        let mut root_cache = None;
        let mut root_pre_post_scripts_enabled = None;
        let mut package_configs: Vec<(PackageNodeIndex, Arc<AbsolutePath>, UserRunConfig)> =
            Vec::with_capacity(package_graph.node_count());

        for package_index in package_graph.node_indices() {
            let package = &package_graph[package_index];
            let package_dir: Arc<AbsolutePath> = workspace_root.path.join(&package.path).into();
            let is_workspace_root = package.path.as_str().is_empty();

            let user_config = config_loader
                .load_user_config_file(&package_dir)
                .await
                .map_err(|error| TaskGraphLoadError::ConfigLoadError {
                    error,
                    package_path: package_dir.clone(),
                })?
                .unwrap_or_default();

            if let Some(cache) = user_config.cache {
                if is_workspace_root {
                    root_cache = Some(cache);
                } else {
                    return Err(TaskGraphLoadError::CacheInNonRootPackage {
                        package_path: package_dir.clone(),
                    });
                }
            }

            if let Some(val) = user_config.enable_pre_post_scripts {
                if is_workspace_root {
                    root_pre_post_scripts_enabled = Some(val);
                } else {
                    return Err(TaskGraphLoadError::PrePostScriptsInNonRootPackage {
                        package_path: package_dir.clone(),
                    });
                }
            }

            package_configs.push((package_index, package_dir, user_config));
        }

        let resolved_global_cache = ResolvedGlobalCacheConfig::resolve_from(root_cache.as_ref());

        // Second pass: create task nodes (cache is NOT applied here; it's applied at plan time)
        for (package_index, package_dir, user_config) in package_configs {
            let package = &package_graph[package_index];

            // Collect package.json scripts into a mutable map for draining lookup.
            let mut package_json_scripts: FxHashMap<&str, &str> = package
                .package_json
                .scripts
                .iter()
                .map(|(name, value)| (name.as_str(), value.as_str()))
                .collect();

            for (task_name, task_user_config) in user_config.tasks.unwrap_or_default() {
                // Error if a package.json script with the same name exists
                if package_json_scripts.remove(task_name.as_str()).is_some() {
                    return Err(TaskGraphLoadError::ScriptConflict {
                        task_display: TaskDisplay {
                            package_name: package.package_json.name.clone(),
                            task_name: task_name.clone(),
                            package_path: Arc::clone(&package_dir),
                        },
                    });
                }

                let task_id = TaskId { task_name: task_name.clone(), package_index };

                let dependency_specifiers = task_user_config.options.depends_on.clone();

                // Resolve the task configuration from the user config
                let resolved_config = ResolvedTaskConfig::resolve(
                    task_user_config,
                    &package_dir,
                    &workspace_root.path,
                )
                .map_err(|err| TaskGraphLoadError::ResolveConfigError {
                    error: err,
                    task_display: TaskDisplay {
                        package_name: package.package_json.name.clone(),
                        task_name: task_name.clone(),
                        package_path: Arc::clone(&package_dir),
                    },
                })?;

                let task_node = TaskNode {
                    task_display: TaskDisplay {
                        package_name: package.package_json.name.clone(),
                        task_name: task_name.clone(),
                        package_path: Arc::clone(&package_dir),
                    },
                    resolved_config,
                    source: TaskSource::TaskConfig,
                };

                let node_index = task_graph.add_node(task_node);
                task_ids_with_dependency_specifiers.push((task_id.clone(), dependency_specifiers));
                task_ids_by_node_index.insert(node_index, task_id.clone());
                node_indices_by_task_id.insert(task_id, node_index);
            }

            // For remaining package.json scripts not in the tasks map, create tasks with default config
            for (script_name, package_json_script) in package_json_scripts {
                let task_id = TaskId { task_name: Str::from(script_name), package_index };
                let resolved_config = ResolvedTaskConfig::resolve_package_json_script(
                    &package_dir,
                    package_json_script,
                    &workspace_root.path,
                )
                .map_err(|err| TaskGraphLoadError::ResolveConfigError {
                    error: err,
                    task_display: TaskDisplay {
                        package_name: package.package_json.name.clone(),
                        task_name: script_name.into(),
                        package_path: Arc::clone(&package_dir),
                    },
                })?;
                let node_index = task_graph.add_node(TaskNode {
                    task_display: TaskDisplay {
                        package_name: package.package_json.name.clone(),
                        task_name: script_name.into(),
                        package_path: Arc::clone(&package_dir),
                    },
                    resolved_config,
                    source: TaskSource::PackageJsonScript,
                });
                task_ids_by_node_index.insert(node_index, task_id.clone());
                node_indices_by_task_id.insert(task_id, node_index);
            }
        }

        // Construct `Self` with task_graph with all task nodes ready and indexed, but no edges.
        let mut me = Self {
            task_graph,
            indexed_package_graph: IndexedPackageGraph::index(package_graph),
            node_indices_by_task_id,
            task_ids_by_node_index,
            resolved_global_cache,
            pre_post_scripts_enabled: root_pre_post_scripts_enabled.unwrap_or(true),
        };

        // Add explicit dependencies
        for (from_task_id, dependency_specifiers) in task_ids_with_dependency_specifiers {
            let from_node_index = me.node_indices_by_task_id[&from_task_id];
            for specifier in dependency_specifiers.iter().flat_map(|s| s.iter()).cloned() {
                let to_node_index = me
                    .get_task_index_by_specifier::<Infallible>(
                        TaskSpecifier::parse_raw(&specifier),
                        || Ok(from_task_id.package_index),
                    )
                    .map_err(|error| TaskGraphLoadError::DependencySpecifierLookupError {
                        error,
                        specifier,
                        task_display: me.display_task(from_node_index),
                    })?;
                me.task_graph.update_edge(from_node_index, to_node_index, TaskDependencyType);
            }
        }

        // Topological dependency edges are no longer pre-computed here.
        // Ordering is now handled at query time via the package subgraph induced by
        // `IndexedPackageGraph::resolve_query` in `query/mod.rs`.
        Ok(me)
    }

    /// Lookup the node index of a task by a specifier.
    ///
    /// The specifier can be either 'packageName#taskName' or just 'taskName' (in which case the task in the origin package is looked up).
    fn get_task_index_by_specifier<PackageUnknownError>(
        &self,
        specifier: TaskSpecifier,
        get_package_origin: impl FnOnce() -> Result<PackageNodeIndex, PackageUnknownError>,
    ) -> Result<TaskNodeIndex, SpecifierLookupError<PackageUnknownError>> {
        let package_index = if let Some(package_name) = specifier.package_name {
            // Lookup package path by the package name from '#'
            let Some(package_indices) =
                self.indexed_package_graph.get_package_indices_by_name(&package_name)
            else {
                return Err(SpecifierLookupError::PackageNameNotFound { package_name });
            };
            if package_indices.len() > 1 {
                return Err(SpecifierLookupError::AmbiguousPackageName {
                    package_name,
                    package_paths: package_indices
                        .iter()
                        .map(|package_index| {
                            Arc::clone(
                                &self.indexed_package_graph.package_graph()[*package_index]
                                    .absolute_path,
                            )
                        })
                        .collect(),
                });
            }
            *package_indices.first()
        } else {
            // No '#', so the specifier only contains task name, look up in the origin path package
            get_package_origin().map_err(|err| SpecifierLookupError::PackageUnknown {
                unspecifier_package_error: err,
                task_name: specifier.task_name.clone(),
            })?
        };
        let task_id_to_lookup = TaskId { task_name: specifier.task_name, package_index };
        let Some(node_index) = self.node_indices_by_task_id.get(&task_id_to_lookup) else {
            return Err(SpecifierLookupError::TaskNameNotFound {
                package_name: self.indexed_package_graph.package_graph()[package_index]
                    .package_json
                    .name
                    .clone(),
                task_name: task_id_to_lookup.task_name,
                package_index,
            });
        };
        Ok(*node_index)
    }

    #[must_use]
    pub const fn task_graph(&self) -> &TaskGraph {
        &self.task_graph
    }

    #[must_use]
    pub fn get_package_name(&self, package_index: PackageNodeIndex) -> &str {
        self.indexed_package_graph.package_graph()[package_index].package_json.name.as_str()
    }

    #[must_use]
    pub fn get_package_path(&self, package_index: PackageNodeIndex) -> &Arc<AbsolutePath> {
        &self.indexed_package_graph.package_graph()[package_index].absolute_path
    }

    #[must_use]
    pub fn get_package_path_for_task(&self, task_index: TaskNodeIndex) -> &Arc<AbsolutePath> {
        &self.task_graph[task_index].task_display.package_path
    }

    /// Get the package path for a given current working directory by traversing up the directory
    /// tree to find the nearest package.
    #[must_use]
    pub fn get_package_path_from_cwd(&self, cwd: &AbsolutePath) -> Option<&Arc<AbsolutePath>> {
        let index = self.indexed_package_graph.get_package_index_from_cwd(cwd)?;
        Some(self.get_package_path(index))
    }

    #[must_use]
    pub const fn global_cache_config(&self) -> &ResolvedGlobalCacheConfig {
        &self.resolved_global_cache
    }

    /// Whether pre/post script hooks are enabled workspace-wide.
    #[must_use]
    pub const fn pre_post_scripts_enabled(&self) -> bool {
        self.pre_post_scripts_enabled
    }

    /// Returns the `TaskNodeIndex` of the pre/post hook for a `PackageJsonScript` task.
    ///
    /// Given a task named `X` and `prefix = "pre"`, looks up `preX` in the same package.
    /// Given a task named `X` and `prefix = "post"`, looks up `postX` in the same package.
    ///
    /// Returns `None` if:
    /// - The task is not a `PackageJsonScript`
    /// - No `{prefix}{name}` script exists in the same package
    /// - The hook is not itself a `PackageJsonScript`
    #[must_use]
    pub fn get_script_hook(&self, task_idx: TaskNodeIndex, prefix: &str) -> Option<TaskNodeIndex> {
        let task_node = &self.task_graph[task_idx];
        if task_node.source != TaskSource::PackageJsonScript {
            return None;
        }
        let task_id = self.task_ids_by_node_index.get(&task_idx)?;
        let hook_name = vite_str::format!("{prefix}{}", task_node.task_display.task_name);
        let hook_id = TaskId { package_index: task_id.package_index, task_name: hook_name };
        let &hook_idx = self.node_indices_by_task_id.get(&hook_id)?;
        (self.task_graph[hook_idx].source == TaskSource::PackageJsonScript).then_some(hook_idx)
    }
}
