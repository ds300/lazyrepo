pub mod cache_metadata;
mod context;
mod envs;
mod error;
pub mod execution_graph;
mod in_process;
mod path_env;
mod plan;
pub mod plan_request;

use std::{collections::BTreeMap, ffi::OsStr, fmt::Debug, sync::Arc};

use context::PlanContext;
pub use error::Error;
pub use execution_graph::ExecutionGraph;
pub use in_process::InProcessExecution;
pub use path_env::{get_path_env, prepend_path_env};
use plan::{ParentCacheConfig, plan_query_request, plan_synthetic_request};
use plan_request::{CacheOverride, PlanRequest, QueryPlanRequest, SyntheticPlanRequest};
use rustc_hash::FxHashMap;
use serde::{Serialize, ser::SerializeMap as _};
use vite_path::AbsolutePath;
use vite_str::Str;
use vite_task_graph::{TaskGraphLoadError, display::TaskDisplay};

/// A resolved spawn execution.
///
/// Unlike tasks in `vite_task_graph`, this struct contains all information needed for execution,
/// like resolved environment variables, current working directory, and additional args from cli.
#[derive(Debug, Serialize)]
pub struct SpawnExecution {
    /// Cache metadata for this execution. `None` means caching is disabled.
    pub cache_metadata: Option<cache_metadata::CacheMetadata>,

    /// All information about a command to be spawned
    pub spawn_command: SpawnCommand,
}

/// All information about a command to be spawned.
#[derive(Debug, Serialize)]
pub struct SpawnCommand {
    /// A program with args to be executed directly
    pub program_path: Arc<AbsolutePath>,

    /// args to be passed to the program
    pub args: Arc<[Str]>,

    /// Environment variables to set for the command, including both fingerprinted and untracked envs.
    #[serde(serialize_with = "serialize_envs")]
    pub all_envs: Arc<BTreeMap<Arc<OsStr>, Arc<OsStr>>>,

    /// Current working directory
    pub cwd: Arc<AbsolutePath>,
}

/// Serialize environment variables as a map from string to string for better readability.
fn serialize_envs<S>(
    envs: &BTreeMap<Arc<OsStr>, Arc<OsStr>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let mut map_ser = serializer.serialize_map(Some(envs.len()))?;
    for (key, value) in envs {
        map_ser.serialize_entry(&key.display().to_string(), &value.display().to_string())?;
    }
    map_ser.end()
}

/// Represents how a task should be executed. It's the node type for the execution graph. Each node corresponds to a task.
#[derive(Debug, Serialize)]
pub struct TaskExecution {
    /// The task this execution corresponds to
    pub task_display: TaskDisplay,

    /// A task's command is split by `&&` and expanded into multiple execution items.
    ///
    /// It contains a single item if the command has no `&&`
    pub items: Vec<ExecutionItem>,
}

impl vite_graph_ser::GetKey for TaskExecution {
    type Key<'a> = (&'a AbsolutePath, &'a str);

    #[expect(
        clippy::disallowed_types,
        reason = "vite_graph_ser::GetKey uses String in its trait definition"
    )]
    fn key(&self) -> Result<Self::Key<'_>, String> {
        Ok((&self.task_display.package_path, &self.task_display.task_name))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecutionItemDisplay {
    /// Human-readable display for the task this execution item corresponds to.
    pub task_display: TaskDisplay,

    /// The command to be executed, including the extra args.
    /// For displaying purpose only.
    /// `SpawnExecution` contains the actual args for execution.
    pub command: Str,

    /// The index of this execution item among all items in the task's command split by `&&`.
    /// If the task's command doesn't have `&&`, this will be `None`.
    pub and_item_index: Option<usize>,

    /// The cwd when this execution item is planned.
    /// This is for displaying purpose only.
    ///
    /// `SpawnExecution.cwd` contains the actual cwd for execution.
    /// These two may differ if the task synthesizer returns a task with a different cwd.
    ///
    /// Hypothetically , if `vp lint-src` under cwd `packages/lib` synthesizes a task spawning `oxlint` under `packages/lib/src`.
    /// The spawned process' cwd will be `packages/lib/src`, while this field will be `packages/lib`,
    /// which will be displayed like `packages/lib$ vp lint-src`
    pub cwd: Arc<AbsolutePath>,
}

/// An execution item, either expanded from a known vp subcommand, or a spawn execution.
#[derive(Debug, Serialize)]
pub struct ExecutionItem {
    /// Human-readable display for this execution item.
    pub execution_item_display: ExecutionItemDisplay,

    /// The kind of this execution item
    pub kind: ExecutionItemKind,
}

/// The kind of a leaf execution item, which cannot be expanded further.
#[derive(Debug, Serialize)]
#[expect(clippy::large_enum_variant, reason = "SpawnExecution is large but not worth boxing")]
pub enum LeafExecutionKind {
    /// The execution is a spawn of a child process
    Spawn(SpawnExecution),
    /// The execution is done in-process by `InProcessExecution::execute()`
    InProcess(InProcessExecution),
}

/// Serialize an `ExecutionGraph` using `serialize_by_key`.
///
/// `vite_graph_ser::serialize_by_key` expects `&DiGraph<N, E, Ix>`, so we call `.inner()`
/// to get the underlying `DiGraph` reference.
/// An execution item, from a split subcommand in a task's command (`item1 && item2 && ...`).
#[derive(Debug, Serialize)]
#[expect(
    clippy::large_enum_variant,
    reason = "SpawnExecution in Leaf is large but not worth boxing"
)]
pub enum ExecutionItemKind {
    /// Expanded from a known vp subcommand, like `vp run ...` or a synthesized task.
    Expanded(ExecutionGraph),
    /// A normal execution that spawns a child process, like `tsc --noEmit`.
    Leaf(LeafExecutionKind),
}

/// The callback trait for parsing plan requests from script commands.
/// See the method for details.
#[async_trait::async_trait(?Send)]
pub trait PlanRequestParser: Debug {
    /// This is called for every parsable command in the task graph in order to determine how to execute it.
    ///
    /// `vite_task_plan` doesn't have the knowledge of how cli args should be parsed. It relies on this callback.
    ///
    /// The implementation can either mutate `command` or return a `PlanRequest`:
    /// - If it returns `Err`, the planning will abort with the returned error.
    /// - If it returns `Ok(None)`, the (potentially mutated) `command` will be spawned as a normal process.
    /// - If it returns `Ok(Some(PlanRequest::Query))`, the command will be expanded as a `ExpandedExecution` with a task graph queried from the returned `TaskQuery`.
    /// - If it returns `Ok(Some(PlanRequest::Synthetic))`, the command will become a `SpawnExecution` with the synthetic task.
    ///
    /// When a `PlanRequest` is returned, any mutations to `command` are discarded.
    async fn get_plan_request(
        &mut self,
        command: &mut plan_request::ScriptCommand,
    ) -> anyhow::Result<Option<PlanRequest>>;
}

#[async_trait::async_trait(?Send)]
pub trait TaskGraphLoader {
    async fn load_task_graph(
        &mut self,
    ) -> Result<&vite_task_graph::IndexedTaskGraph, TaskGraphLoadError>;
}

/// Plan a query execution: load the task graph, query it, and build the execution graph.
///
/// # Errors
/// Returns an error if task graph loading, query, or execution planning fails.
#[tracing::instrument(level = "debug", skip_all)]
#[expect(clippy::implicit_hasher, reason = "FxHashMap is the only hasher used in this codebase")]
pub async fn plan_query(
    query_plan_request: QueryPlanRequest,
    workspace_path: &Arc<AbsolutePath>,
    cwd: &Arc<AbsolutePath>,
    envs: &FxHashMap<Arc<OsStr>, Arc<OsStr>>,
    plan_request_parser: &mut (dyn PlanRequestParser + '_),
    task_graph_loader: &mut (dyn TaskGraphLoader + '_),
) -> Result<ExecutionGraph, Error> {
    let indexed_task_graph = task_graph_loader.load_task_graph().await?;

    let resolved_global_cache = resolve_cache_with_override(
        *indexed_task_graph.global_cache_config(),
        query_plan_request.plan_options.cache_override,
    );

    let QueryPlanRequest { query, plan_options } = query_plan_request;
    let query = Arc::new(query);
    let context = PlanContext::new(
        workspace_path,
        Arc::clone(cwd),
        envs.clone(),
        plan_request_parser,
        indexed_task_graph,
        resolved_global_cache,
        Arc::clone(&query),
    );
    plan_query_request(query, plan_options, context).await
}

const fn resolve_cache_with_override(
    graph_cache: vite_task_graph::config::ResolvedGlobalCacheConfig,
    cache_override: CacheOverride,
) -> vite_task_graph::config::ResolvedGlobalCacheConfig {
    match cache_override {
        CacheOverride::ForceEnabled => {
            vite_task_graph::config::ResolvedGlobalCacheConfig { scripts: true, tasks: true }
        }
        CacheOverride::ForceDisabled => {
            vite_task_graph::config::ResolvedGlobalCacheConfig { scripts: false, tasks: false }
        }
        CacheOverride::None => graph_cache,
    }
}

/// Plan a synthetic task execution, returning the resolved [`SpawnExecution`] directly.
///
/// Unlike [`plan_query`] which returns a full execution graph, synthetic executions
/// are always a single spawned process. The caller can execute it directly using
/// `execute_spawn`.
///
/// # Errors
/// Returns an error if the program is not found or path fingerprinting fails.
#[tracing::instrument(level = "debug", skip_all)]
#[expect(clippy::result_large_err, reason = "Error is large for diagnostics")]
pub fn plan_synthetic(
    workspace_path: &Arc<AbsolutePath>,
    cwd: &Arc<AbsolutePath>,
    synthetic_plan_request: SyntheticPlanRequest,
    cache_key: Arc<[Str]>,
) -> Result<SpawnExecution, Error> {
    let execution_cache_key = cache_metadata::ExecutionCacheKey::ExecAPI(cache_key);
    plan_synthetic_request(
        workspace_path,
        &BTreeMap::default(),
        synthetic_plan_request,
        Some(execution_cache_key),
        cwd,
        ParentCacheConfig::None,
    )
}
