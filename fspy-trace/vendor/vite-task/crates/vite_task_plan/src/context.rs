use std::{env::JoinPathsError, ffi::OsStr, ops::Range, sync::Arc};

use rustc_hash::FxHashMap;
use vite_path::AbsolutePath;
use vite_str::Str;
use vite_task_graph::{
    IndexedTaskGraph, TaskNodeIndex, config::ResolvedGlobalCacheConfig, query::TaskQuery,
};

use crate::{PlanRequestParser, path_env::prepend_path_env};

#[derive(Debug, thiserror::Error)]
#[error(
    "Detected a recursion in task call stack: the last frame calls the {0}th frame", recursion_point + 1
)]
pub struct TaskRecursionError {
    /// The index in `task_call_stack` where the last frame recurses to.
    recursion_point: usize,
}

/// The context for planning an execution from a task.
#[derive(Debug)]
pub struct PlanContext<'a> {
    /// The root path of the workspace.
    workspace_path: &'a Arc<AbsolutePath>,

    /// The current working directory.
    cwd: Arc<AbsolutePath>,

    /// The environment variables for the current execution context.
    envs: FxHashMap<Arc<OsStr>, Arc<OsStr>>,

    /// The callbacks for loading task graphs and parsing commands.
    callbacks: &'a mut (dyn PlanRequestParser + 'a),

    /// The current call stack of task index nodes being planned.
    task_call_stack: Vec<(TaskNodeIndex, Range<usize>)>,

    /// The extra args (`vp run task [extra_arg...]`).
    /// It may come from real cli args, or commands in task scripts.
    extra_args: Arc<[Str]>,

    indexed_task_graph: &'a IndexedTaskGraph,

    /// Final resolved global cache config, combining the graph's config with any CLI override.
    resolved_global_cache: ResolvedGlobalCacheConfig,

    /// The query that caused the current expansion.
    /// Used by the skip rule to detect and skip duplicate nested expansions.
    parent_query: Arc<TaskQuery>,
}

impl<'a> PlanContext<'a> {
    pub fn new(
        workspace_path: &'a Arc<AbsolutePath>,
        cwd: Arc<AbsolutePath>,
        envs: FxHashMap<Arc<OsStr>, Arc<OsStr>>,
        callbacks: &'a mut (dyn PlanRequestParser + 'a),
        indexed_task_graph: &'a IndexedTaskGraph,
        resolved_global_cache: ResolvedGlobalCacheConfig,
        parent_query: Arc<TaskQuery>,
    ) -> Self {
        Self {
            workspace_path,
            cwd,
            envs,
            callbacks,
            task_call_stack: Vec::new(),
            indexed_task_graph,
            extra_args: Arc::default(),
            resolved_global_cache,
            parent_query,
        }
    }

    pub const fn envs(&self) -> &FxHashMap<Arc<OsStr>, Arc<OsStr>> {
        &self.envs
    }

    /// Check if adding the given task node index would create a recursion in the call stack.
    pub fn check_recursion(
        &self,
        task_node_index: TaskNodeIndex,
    ) -> Result<(), TaskRecursionError> {
        if let Some(recursion_start) =
            self.task_call_stack.iter().position(|(idx, _)| *idx == task_node_index)
        {
            return Err(TaskRecursionError { recursion_point: recursion_start });
        }
        Ok(())
    }

    pub const fn indexed_task_graph(&self) -> &'a IndexedTaskGraph {
        self.indexed_task_graph
    }

    pub const fn workspace_path(&self) -> &Arc<AbsolutePath> {
        self.workspace_path
    }

    /// Push a new frame onto the task call stack.
    pub fn push_stack_frame(&mut self, task_node_index: TaskNodeIndex, command_span: Range<usize>) {
        self.task_call_stack.push((task_node_index, command_span));
    }

    pub fn callbacks(&mut self) -> &mut (dyn PlanRequestParser + '_) {
        self.callbacks
    }

    pub fn prepend_path(&mut self, path_to_prepend: &AbsolutePath) -> Result<(), JoinPathsError> {
        prepend_path_env(&mut self.envs, path_to_prepend)
    }

    pub fn add_envs(
        &mut self,
        new_envs: impl Iterator<Item = (impl AsRef<OsStr>, impl AsRef<OsStr>)>,
    ) {
        for (key, value) in new_envs {
            self.envs.insert(Arc::from(key.as_ref()), Arc::from(value.as_ref()));
        }
    }

    pub const fn extra_args(&self) -> &Arc<[Str]> {
        &self.extra_args
    }

    pub fn set_extra_args(&mut self, extra_args: Arc<[Str]>) {
        self.extra_args = extra_args;
    }

    pub const fn resolved_global_cache(&self) -> &ResolvedGlobalCacheConfig {
        &self.resolved_global_cache
    }

    pub const fn set_resolved_global_cache(&mut self, config: ResolvedGlobalCacheConfig) {
        self.resolved_global_cache = config;
    }

    pub fn parent_query(&self) -> &TaskQuery {
        &self.parent_query
    }

    pub fn set_parent_query(&mut self, query: Arc<TaskQuery>) {
        self.parent_query = query;
    }

    /// Returns the task currently being expanded (whose command triggered a nested query).
    /// This is the last task on the call stack, or `None` at the top level.
    pub fn expanding_task(&self) -> Option<TaskNodeIndex> {
        self.task_call_stack.last().map(|(idx, _)| *idx)
    }

    pub fn duplicate(&mut self) -> PlanContext<'_> {
        PlanContext {
            workspace_path: self.workspace_path,
            cwd: Arc::clone(&self.cwd),
            envs: self.envs.clone(),
            callbacks: self.callbacks,
            task_call_stack: self.task_call_stack.clone(),
            indexed_task_graph: self.indexed_task_graph,
            extra_args: Arc::clone(&self.extra_args),
            resolved_global_cache: self.resolved_global_cache,
            parent_query: Arc::clone(&self.parent_query),
        }
    }
}
