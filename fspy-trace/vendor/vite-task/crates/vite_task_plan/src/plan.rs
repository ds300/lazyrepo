#[expect(
    clippy::disallowed_types,
    reason = "Path is needed for cd command argument and error reporting"
)]
use std::path::Path;
use std::{
    borrow::Cow,
    collections::BTreeMap,
    env::home_dir,
    ffi::OsStr,
    sync::{Arc, LazyLock},
};

use futures_util::FutureExt;
use petgraph::Direction;
use rustc_hash::FxHashMap;
use vite_path::{AbsolutePath, AbsolutePathBuf, RelativePathBuf, relative::InvalidPathDataError};
use vite_shell::try_parse_as_and_list;
use vite_str::Str;
use vite_task_graph::{
    TaskNodeIndex, TaskSource,
    config::{
        CacheConfig, ResolvedGlobalCacheConfig, ResolvedTaskOptions,
        user::{UserCacheConfig, UserTaskOptions},
    },
    query::TaskQuery,
};

use crate::{
    ExecutionItem, ExecutionItemDisplay, ExecutionItemKind, LeafExecutionKind, PlanContext,
    SpawnCommand, SpawnExecution, TaskExecution,
    cache_metadata::{CacheMetadata, ExecutionCacheKey, ProgramFingerprint, SpawnFingerprint},
    envs::EnvFingerprints,
    error::{CdCommandError, Error, PathFingerprintError, PathFingerprintErrorKind, PathType},
    execution_graph::{ExecutionGraph, ExecutionNodeIndex, InnerExecutionGraph},
    in_process::InProcessExecution,
    path_env::get_path_env,
    plan_request::{
        CacheOverride, PlanOptions, PlanRequest, QueryPlanRequest, ScriptCommand,
        SyntheticPlanRequest,
    },
    resolve_cache_with_override,
};

/// Locate the executable path for a given program name in the provided envs and cwd.
fn which(
    program: &Arc<OsStr>,
    envs: &FxHashMap<Arc<OsStr>, Arc<OsStr>>,
    cwd: &Arc<AbsolutePath>,
) -> Result<Arc<AbsolutePath>, crate::error::WhichError> {
    let path_env = get_path_env(envs);
    let executable_path = which::which_in(program, path_env, cwd.as_path()).map_err(|err| {
        crate::error::WhichError {
            program: Arc::clone(program),
            path_env: path_env.map(Arc::clone),
            cwd: Arc::clone(cwd),
            error: err,
        }
    })?;
    Ok(AbsolutePathBuf::new(executable_path)
        .expect("path returned by which::which_in should always be absolute")
        .into())
}

/// Compute the effective cache config for a task, applying the global cache config.
///
/// The task graph stores per-task cache config without applying the global kill switch.
/// This function applies the global config at plan time, checking `cache.scripts` for
/// package.json scripts and `cache.tasks` for task-map entries.
fn effective_cache_config(
    task_cache_config: Option<&CacheConfig>,
    source: TaskSource,
    resolved_global_cache: ResolvedGlobalCacheConfig,
) -> Option<CacheConfig> {
    let enabled = match source {
        TaskSource::PackageJsonScript => resolved_global_cache.scripts,
        TaskSource::TaskConfig => resolved_global_cache.tasks,
    };
    if enabled { task_cache_config.cloned() } else { None }
}

/// - `with_hooks`: whether to look up `preX`/`postX` lifecycle hooks for this task.
///   `false` when the task itself is being executed as a hook, so that hooks are
///   never expanded more than one level deep (matching npm behavior).
#[expect(clippy::too_many_lines, reason = "sequential planning steps are clearer in one function")]
async fn plan_task_as_execution_node(
    task_node_index: TaskNodeIndex,
    mut context: PlanContext<'_>,
    with_hooks: bool,
) -> Result<TaskExecution, Error> {
    // Check for recursions in the task call stack.
    context.check_recursion(task_node_index)?;

    let task_node = &context.indexed_task_graph().task_graph()[task_node_index];
    let command_str = task_node.resolved_config.command.as_str();

    let package_path = context.indexed_task_graph().get_package_path_for_task(task_node_index);
    // Prepend {package_path}/node_modules/.bin to PATH
    let package_node_modules_bin_path = package_path.join("node_modules").join(".bin");
    if let Err(join_paths_error) = context.prepend_path(&package_node_modules_bin_path) {
        return Err(Error::AddNodeModulesBinPath { join_paths_error });
    }

    let mut items = Vec::<ExecutionItem>::new();

    // Expand pre/post hooks (`preX`/`postX`) for package.json scripts.
    // Hooks are never expanded more than one level deep (matching npm behavior): when planning a
    // hook script, `with_hooks` is false so it won't look for its own pre/post hooks.
    // Resolve the flag once before any mutable borrow of `context` (duplicate() needs &mut).
    let pre_post_scripts_enabled =
        with_hooks && context.indexed_task_graph().pre_post_scripts_enabled();
    let pre_hook_idx = if pre_post_scripts_enabled {
        context.indexed_task_graph().get_script_hook(task_node_index, "pre")
    } else {
        None
    };
    if let Some(pre_hook_idx) = pre_hook_idx {
        let mut pre_context = context.duplicate();
        // Extra args (e.g. `vt run test --coverage`) must not be forwarded to hooks.
        pre_context.set_extra_args(Arc::new([]));
        let pre_execution =
            Box::pin(plan_task_as_execution_node(pre_hook_idx, pre_context, false)).await?;
        items.extend(pre_execution.items);
    }

    // Use task's resolved cwd for display (from task config's cwd option)
    let mut cwd = Arc::clone(&task_node.resolved_config.resolved_options.cwd);

    // TODO: variable expansion (https://crates.io/crates/shellexpand) BEFORE parsing
    // Try to parse the command string as a list of subcommands separated by `&&`
    if let Some(parsed_subcommands) = try_parse_as_and_list(command_str) {
        let and_item_count = parsed_subcommands.len();
        for (index, (and_item, add_item_span)) in parsed_subcommands.into_iter().enumerate() {
            // Duplicate the context before modifying it for each and_item
            let mut context = context.duplicate();
            context.push_stack_frame(task_node_index, add_item_span.clone());

            let mut args = and_item.args;
            let extra_args = if index == and_item_count - 1 {
                // For the last and_item, append extra args from the plan context
                Arc::clone(context.extra_args())
            } else {
                Arc::new([])
            };
            args.extend(extra_args.iter().cloned());

            // Handle `cd` builtin command
            if and_item.program == "cd" {
                #[expect(
                    clippy::disallowed_types,
                    reason = "Path is needed for std::env::home_dir return type and AbsolutePath::join"
                )]
                let cd_target: Cow<'_, Path> = match args.as_slice() {
                    // No args, go to home directory
                    [] => {
                        home_dir().ok_or(Error::CdCommand(CdCommandError::NoHomeDirectory))?.into()
                    }
                    [dir] => Path::new(dir.as_str()).into(),
                    _ => {
                        return Err(Error::CdCommand(CdCommandError::ToManyArgs));
                    }
                };
                cwd = cwd.join(cd_target.as_ref()).into();
                continue;
            }

            // Build execution display
            let execution_item_display = ExecutionItemDisplay {
                command: {
                    let mut command = Str::from(&command_str[add_item_span.clone()]);
                    for arg in extra_args.iter() {
                        command.push(' ');
                        command.push_str(shell_escape::escape(arg.as_str().into()).as_ref());
                    }
                    command
                },
                and_item_index: if and_item_count > 1 { Some(index) } else { None },
                cwd: Arc::clone(&cwd),
                task_display: task_node.task_display.clone(),
            };

            // Check for builtin commands like `echo ...`
            if let Some(builtin_execution) =
                InProcessExecution::get_builtin_execution(&and_item.program, args.iter(), &cwd)
            {
                items.push(ExecutionItem {
                    execution_item_display,
                    kind: ExecutionItemKind::Leaf(LeafExecutionKind::InProcess(builtin_execution)),
                });
                continue;
            }

            // Create execution cache key for this and_item
            let task_execution_cache_key = ExecutionCacheKey::UserTask {
                task_name: task_node.task_display.task_name.clone(),
                and_item_index: index,
                extra_args: Arc::clone(&extra_args),
                package_path: strip_prefix_for_cache(package_path, context.workspace_path())
                    .map_err(|kind| PathFingerprintError {
                        kind,
                        path_type: PathType::PackagePath,
                    })?,
            };

            // Try to parse the args of an and_item to a plan request like `run -r build`
            let envs: Arc<FxHashMap<Arc<OsStr>, Arc<OsStr>>> = context.envs().clone().into();
            let mut script_command = ScriptCommand {
                program: and_item.program.clone(),
                args: args.into(),
                envs,
                cwd: Arc::clone(&cwd),
            };
            let plan_request =
                context.callbacks().get_plan_request(&mut script_command).await.map_err(
                    |error| Error::ParsePlanRequest {
                        program: script_command.program.clone(),
                        args: Arc::clone(&script_command.args),
                        cwd: Arc::clone(&script_command.cwd),
                        error,
                    },
                )?;

            let execution_item_kind: ExecutionItemKind = match plan_request {
                // Expand task query like `vp run -r build`
                Some(PlanRequest::Query(query_plan_request)) => {
                    // Skip rule: skip if this nested query is the same as the parent expansion.
                    // This handles workspace root tasks like `"build": "vp run -r build"` —
                    // re-entering the same query would just re-expand the same tasks.
                    //
                    // The comparison is on TaskQuery only (package_query + task_name +
                    // include_explicit_deps). Extra args live in PlanOptions, so
                    // `vp run -r build extra_arg` still matches `vp run -r build`.
                    // Conversely, `cd packages/a && vp run build` does NOT match a
                    // parent `vp run build` from root because `cd` changes the cwd,
                    // producing a different ContainingPackage in the PackageQuery.
                    if query_plan_request.query == *context.parent_query() {
                        continue;
                    }

                    // Save task name before consuming the request
                    let task_name = query_plan_request.query.task_name.clone();
                    // Add prefix envs to the context
                    context.add_envs(and_item.envs.iter());
                    let QueryPlanRequest { query, plan_options } = query_plan_request;
                    let query = Arc::new(query);
                    let execution_graph =
                        plan_query_request(Arc::clone(&query), plan_options, context)
                            .await
                            .map_err(|error| Error::NestPlan {
                                task_display: task_node.task_display.clone(),
                                command: Str::from(&command_str[add_item_span.clone()]),
                                error: Box::new(error),
                            })?;
                    // An empty execution graph means no tasks matched the query.
                    // At the top level the session shows the task selector UI,
                    // but in a nested context there is no UI — propagate as an error.
                    if execution_graph.node_count() == 0 {
                        return Err(Error::NestPlan {
                            task_display: task_node.task_display.clone(),
                            command: Str::from(&command_str[add_item_span]),
                            error: Box::new(Error::NoTasksMatched(task_name)),
                        });
                    }
                    ExecutionItemKind::Expanded(execution_graph)
                }
                // Synthetic task (from CommandHandler)
                Some(PlanRequest::Synthetic(synthetic_plan_request)) => {
                    let task_effective_cache = effective_cache_config(
                        task_node.resolved_config.resolved_options.cache_config.as_ref(),
                        task_node.source,
                        *context.resolved_global_cache(),
                    );
                    let parent_cache_config = task_effective_cache
                        .as_ref()
                        .map_or(ParentCacheConfig::Disabled, |config| {
                            ParentCacheConfig::Inherited(config.clone())
                        });
                    let spawn_execution = plan_synthetic_request(
                        context.workspace_path(),
                        &and_item.envs,
                        synthetic_plan_request,
                        Some(task_execution_cache_key),
                        &cwd,
                        parent_cache_config,
                    )?;
                    ExecutionItemKind::Leaf(LeafExecutionKind::Spawn(spawn_execution))
                }
                // Normal 3rd party tool command (like `tsc --noEmit`), using potentially mutated script_command
                None => {
                    let program_path = which(
                        &OsStr::new(&script_command.program).into(),
                        &script_command.envs,
                        &script_command.cwd,
                    )?;
                    let resolved_options = ResolvedTaskOptions {
                        cwd: Arc::clone(&task_node.resolved_config.resolved_options.cwd),
                        cache_config: effective_cache_config(
                            task_node.resolved_config.resolved_options.cache_config.as_ref(),
                            task_node.source,
                            *context.resolved_global_cache(),
                        ),
                    };
                    let spawn_execution = plan_spawn_execution(
                        context.workspace_path(),
                        Some(task_execution_cache_key),
                        &and_item.envs,
                        &resolved_options,
                        &script_command.envs,
                        program_path,
                        script_command.args,
                    )?;
                    ExecutionItemKind::Leaf(LeafExecutionKind::Spawn(spawn_execution))
                }
            };
            items.push(ExecutionItem { execution_item_display, kind: execution_item_kind });
        }
    } else {
        #[expect(clippy::disallowed_types, reason = "PathBuf needed for which fallback path")]
        static SHELL_PROGRAM_PATH: LazyLock<Arc<AbsolutePath>> =
            LazyLock::new(|| {
                if cfg!(target_os = "windows") {
                    AbsolutePathBuf::new(which::which("cmd.exe").unwrap_or_else(|_| {
                        std::path::PathBuf::from("C:\\Windows\\System32\\cmd.exe")
                    }))
                    .unwrap()
                    .into()
                } else {
                    AbsolutePath::new("/bin/sh").unwrap().into()
                }
            });

        static SHELL_ARGS: &[&str] =
            if cfg!(target_os = "windows") { &["/d", "/s", "/c"] } else { &["-c"] };

        let mut context = context.duplicate();
        context.push_stack_frame(task_node_index, 0..command_str.len());

        let execution_item_display = ExecutionItemDisplay {
            command: command_str.into(),
            and_item_index: None,
            cwd,
            task_display: task_node.task_display.clone(),
        };

        let mut script = Str::from(command_str);
        for arg in context.extra_args().iter() {
            script.push(' ');
            script.push_str(shell_escape::escape(arg.as_str().into()).as_ref());
        }

        let resolved_options = ResolvedTaskOptions {
            cwd: Arc::clone(&task_node.resolved_config.resolved_options.cwd),
            cache_config: effective_cache_config(
                task_node.resolved_config.resolved_options.cache_config.as_ref(),
                task_node.source,
                *context.resolved_global_cache(),
            ),
        };
        let spawn_execution = plan_spawn_execution(
            context.workspace_path(),
            Some(ExecutionCacheKey::UserTask {
                task_name: task_node.task_display.task_name.clone(),
                and_item_index: 0,
                extra_args: Arc::clone(context.extra_args()),
                package_path: strip_prefix_for_cache(package_path, context.workspace_path())
                    .map_err(|kind| PathFingerprintError {
                        kind,
                        path_type: PathType::PackagePath,
                    })?,
            }),
            &BTreeMap::new(),
            &resolved_options,
            context.envs(),
            Arc::clone(&*SHELL_PROGRAM_PATH),
            SHELL_ARGS.iter().map(|s| Str::from(*s)).chain(std::iter::once(script)).collect(),
        )?;
        items.push(ExecutionItem {
            execution_item_display,
            kind: ExecutionItemKind::Leaf(LeafExecutionKind::Spawn(spawn_execution)),
        });
    }

    // Expand post-hook (`postX`) for package.json scripts.
    let post_hook_idx = if pre_post_scripts_enabled {
        context.indexed_task_graph().get_script_hook(task_node_index, "post")
    } else {
        None
    };
    if let Some(post_hook_idx) = post_hook_idx {
        let mut post_context = context.duplicate();
        // Extra args must not be forwarded to hooks.
        post_context.set_extra_args(Arc::new([]));
        let post_execution =
            Box::pin(plan_task_as_execution_node(post_hook_idx, post_context, false)).await?;
        items.extend(post_execution.items);
    }

    Ok(TaskExecution { task_display: task_node.task_display.clone(), items })
}

/// Cache configuration inherited from the parent task that contains a synthetic command.
///
/// When a synthetic task (e.g., `vp lint` expanding to `oxlint`) appears inside a
/// user-defined task's script, the parent task's cache configuration should constrain
/// the synthetic task's caching behavior.
pub enum ParentCacheConfig {
    /// No parent task (top-level synthetic command like `vp lint` run directly).
    /// The synthetic task uses its own default cache configuration.
    None,

    /// Parent task has caching disabled (`cache: false` or `cache.scripts` not enabled).
    /// The synthetic task should also have caching disabled.
    Disabled,

    /// Parent task has caching enabled with this configuration.
    /// The synthetic task inherits this config, merged with its own additions.
    Inherited(CacheConfig),
}

/// Resolves the effective cache configuration for a synthetic task by combining
/// the parent task's cache config with the synthetic command's own additions.
///
/// Synthetic tasks (e.g., `vp lint` → `oxlint`) may declare their own cache-related
/// env requirements (e.g., `untracked_env` for env-test). When a parent task
/// exists, its cache config takes precedence:
/// - If the parent disables caching, the synthetic task is also uncached.
/// - If the parent enables caching but the synthetic disables it, caching is disabled.
/// - If both parent and synthetic enable caching, the synthetic inherits the parent's
///   env config and merges in any additional envs the synthetic command needs.
/// - If there is no parent (top-level invocation), the synthetic task's own
///   [`UserCacheConfig`] is resolved with defaults.
#[expect(clippy::result_large_err, reason = "Error is large for diagnostics")]
fn resolve_synthetic_cache_config(
    parent: ParentCacheConfig,
    synthetic_cache_config: UserCacheConfig,
    cwd: &Arc<AbsolutePath>,
    workspace_path: &AbsolutePath,
) -> Result<Option<CacheConfig>, Error> {
    match parent {
        ParentCacheConfig::None => {
            // Top-level: resolve from synthetic's own config
            Ok(ResolvedTaskOptions::resolve(
                UserTaskOptions {
                    cache_config: synthetic_cache_config,
                    cwd_relative_to_package: None,
                    depends_on: None,
                },
                cwd,
                workspace_path,
            )
            .map_err(Error::ResolveTaskConfig)?
            .cache_config)
        }
        ParentCacheConfig::Disabled => Ok(Option::None),
        ParentCacheConfig::Inherited(mut parent_config) => {
            // Cache is enabled only if both parent and synthetic want it.
            // Merge synthetic's additions into parent's config.
            Ok(match synthetic_cache_config {
                UserCacheConfig::Disabled { .. } => Option::None,
                UserCacheConfig::Enabled { enabled_cache_config, .. } => {
                    if let Some(extra_envs) = enabled_cache_config.env {
                        parent_config.env_config.fingerprinted_envs.extend(extra_envs.into_vec());
                    }
                    if let Some(extra_pts) = enabled_cache_config.untracked_env {
                        parent_config.env_config.untracked_env.extend(extra_pts);
                    }
                    Some(parent_config)
                }
            })
        }
    }
}

#[expect(clippy::result_large_err, reason = "Error is large for diagnostics")]
pub fn plan_synthetic_request(
    workspace_path: &Arc<AbsolutePath>,
    prefix_envs: &BTreeMap<Str, Str>,
    synthetic_plan_request: SyntheticPlanRequest,
    execution_cache_key: Option<ExecutionCacheKey>,
    cwd: &Arc<AbsolutePath>,
    parent_cache_config: ParentCacheConfig,
) -> Result<SpawnExecution, Error> {
    let SyntheticPlanRequest { program, args, cache_config, envs } = synthetic_plan_request;

    let program_path = which(&program, &envs, cwd)?;
    let resolved_cache_config =
        resolve_synthetic_cache_config(parent_cache_config, cache_config, cwd, workspace_path)?;
    let resolved_options =
        ResolvedTaskOptions { cwd: Arc::clone(cwd), cache_config: resolved_cache_config };

    plan_spawn_execution(
        workspace_path,
        execution_cache_key,
        prefix_envs,
        &resolved_options,
        &envs,
        program_path,
        args,
    )
}

fn strip_prefix_for_cache(
    path: &Arc<AbsolutePath>,
    workspace_path: &Arc<AbsolutePath>,
) -> Result<RelativePathBuf, PathFingerprintErrorKind> {
    match path.strip_prefix(workspace_path) {
        Ok(Some(rel_path)) => Ok(rel_path),
        Ok(None) => Err(PathFingerprintErrorKind::PathOutsideWorkspace {
            path: Arc::clone(path),
            workspace_path: Arc::clone(workspace_path),
        }),
        Err(err) => Err(PathFingerprintErrorKind::NonPortableRelativePath {
            path: err.stripped_path.into(),
            error: err.invalid_path_data_error,
        }),
    }
}

#[expect(clippy::result_large_err, reason = "Error is large for diagnostics")]
#[expect(
    clippy::needless_pass_by_value,
    reason = "program_path ownership is needed for Arc construction"
)]
fn plan_spawn_execution(
    workspace_path: &Arc<AbsolutePath>,
    execution_cache_key: Option<ExecutionCacheKey>,
    prefix_envs: &BTreeMap<Str, Str>,
    resolved_task_options: &ResolvedTaskOptions,
    envs: &FxHashMap<Arc<OsStr>, Arc<OsStr>>,
    program_path: Arc<AbsolutePath>,
    args: Arc<[Str]>,
) -> Result<SpawnExecution, Error> {
    // all envs available in the current context
    let mut all_envs = envs.clone();
    let cwd = Arc::clone(&resolved_task_options.cwd);

    let mut resolved_cache_metadata = None;
    if let Some(cache_config) = &resolved_task_options.cache_config {
        // Resolve envs according cache configs
        let mut env_fingerprints =
            EnvFingerprints::resolve(&mut all_envs, &cache_config.env_config)
                .map_err(Error::ResolveEnv)?;

        // Add prefix envs to fingerprinted envs
        env_fingerprints
            .fingerprinted_envs
            .extend(prefix_envs.iter().map(|(name, value)| (name.clone(), value.as_str().into())));

        let program_fingerprint = match strip_prefix_for_cache(&program_path, workspace_path) {
            Ok(relative_program_path) => {
                ProgramFingerprint::InsideWorkspace { relative_program_path }
            }
            Err(PathFingerprintErrorKind::PathOutsideWorkspace { path, .. }) => {
                let program_name_os_str = path.as_path().file_name().unwrap_or_default();
                #[expect(
                    clippy::manual_let_else,
                    reason = "? operator doesn't apply since early return has a different error type"
                )]
                let program_name_str = match program_name_os_str.to_str() {
                    Some(s) => s,
                    None => {
                        #[expect(
                            clippy::disallowed_types,
                            reason = "Arc<Path> for non-UTF-8 path data in error"
                        )]
                        return Err(PathFingerprintError {
                            kind: PathFingerprintErrorKind::NonPortableRelativePath {
                                path: Path::new(program_name_os_str).into(),
                                error: InvalidPathDataError::NonUtf8,
                            },
                            path_type: PathType::Program,
                        }
                        .into());
                    }
                };
                ProgramFingerprint::OutsideWorkspace { program_name: program_name_str.into() }
            }
            Err(err) => {
                return Err(PathFingerprintError { kind: err, path_type: PathType::Program }.into());
            }
        };

        let spawn_fingerprint: SpawnFingerprint = SpawnFingerprint {
            cwd: strip_prefix_for_cache(&cwd, workspace_path)
                .map_err(|kind| PathFingerprintError { kind, path_type: PathType::Cwd })?,
            program_fingerprint,
            args: Arc::clone(&args),
            env_fingerprints,
        };
        if let Some(execution_cache_key) = execution_cache_key {
            resolved_cache_metadata = Some(CacheMetadata {
                spawn_fingerprint,
                execution_cache_key,
                input_config: cache_config.input_config.clone(),
            });
        }
    }

    // Add prefix envs to all envs
    all_envs.extend(prefix_envs.iter().map(|(name, value)| {
        (OsStr::new(name.as_str()).into(), OsStr::new(value.as_str()).into())
    }));

    Ok(SpawnExecution {
        spawn_command: SpawnCommand {
            program_path,
            args: Arc::clone(&args),
            cwd,
            all_envs: Arc::new(all_envs.into_iter().collect()),
        },
        cache_metadata: resolved_cache_metadata,
    })
}

/// Expand the parsed task request (like `run -r build`/`lint`) into an execution graph.
///
/// Builds a `DiGraph` of task executions, then validates it is acyclic via
/// `ExecutionGraph::try_from_graph`. Returns `CycleDependencyDetected` if a cycle is found.
///
/// **Prune rule:** If the expanding task (the task whose command triggered
/// this nested query) appears in the expansion result, it is pruned from the graph
/// and its predecessors are wired directly to its successors. This prevents
/// workspace root tasks like `"build": "vp run -r build"` from infinitely
/// re-expanding themselves when a different query reaches them (e.g.,
/// `vp run build` produces a different query than the script's `vp run -r build`,
/// so the skip rule doesn't fire, but the prune rule catches root in the result).
/// Like the skip rule, extra args don't affect this — only the `TaskQuery` matters.
pub async fn plan_query_request(
    query: Arc<TaskQuery>,
    plan_options: PlanOptions,
    mut context: PlanContext<'_>,
) -> Result<ExecutionGraph, Error> {
    // Apply cache override from `--cache` / `--no-cache` flags on this request.
    //
    // When `None`, we skip the update so the context keeps whatever the parent
    // resolved — this is how `vp run --cache outer` propagates to a nested
    // `vp run inner` that has no flags of its own.
    let cache_override = plan_options.cache_override;
    if cache_override != CacheOverride::None {
        // Override is relative to the *workspace* config, not the parent's
        // resolved config. This means `vp run --no-cache outer` where outer
        // runs `vp run --cache inner` re-enables caching from the workspace
        // defaults, rather than from the parent's disabled state.
        let final_cache = resolve_cache_with_override(
            *context.indexed_task_graph().global_cache_config(),
            cache_override,
        );
        context.set_resolved_global_cache(final_cache);
    }
    context.set_extra_args(plan_options.extra_args);
    context.set_parent_query(Arc::clone(&query));

    // Query matching tasks from the task graph.
    // An empty graph means no tasks matched; the caller (session) handles
    // empty graphs by showing the task selector.
    let task_query_result = context.indexed_task_graph().query_tasks(&query)?;

    #[expect(clippy::print_stderr, reason = "user-facing warning for typos in --filter")]
    for selector in &task_query_result.unmatched_selectors {
        eprintln!("No packages matched the filter: {selector}");
    }

    let task_node_index_graph = task_query_result.execution_graph;

    // Prune rule: if the expanding task appears in the expansion, prune it.
    // This handles cases like root `"build": "vp run build"` — the root's build
    // task is in the result but expanding it would recurse, so we remove it and
    // reconnect its predecessors directly to its successors.
    let pruned_task = context.expanding_task().filter(|t| task_node_index_graph.contains_node(*t));

    let mut execution_node_indices_by_task_index =
        FxHashMap::<TaskNodeIndex, ExecutionNodeIndex>::with_capacity_and_hasher(
            task_node_index_graph.node_count(),
            rustc_hash::FxBuildHasher,
        );

    // Build the inner DiGraph first, then validate acyclicity at the end.
    let mut inner_graph = InnerExecutionGraph::with_capacity(
        task_node_index_graph.node_count(),
        task_node_index_graph.edge_count(),
    );

    // Plan each task node as execution nodes, skipping the pruned task
    for task_index in task_node_index_graph.nodes() {
        if Some(task_index) == pruned_task {
            continue;
        }
        let task_execution = plan_task_as_execution_node(task_index, context.duplicate(), true)
            .boxed_local()
            .await?;
        execution_node_indices_by_task_index
            .insert(task_index, inner_graph.add_node(task_execution));
    }

    // Add edges between execution nodes according to task dependencies,
    // skipping edges involving the pruned task.
    for (from_task_index, to_task_index, ()) in task_node_index_graph.all_edges() {
        if Some(from_task_index) == pruned_task || Some(to_task_index) == pruned_task {
            continue;
        }
        inner_graph.add_edge(
            execution_node_indices_by_task_index[&from_task_index],
            execution_node_indices_by_task_index[&to_task_index],
            (),
        );
    }

    // Reconnect through the pruned node: wire each predecessor directly to each successor.
    if let Some(pruned) = pruned_task {
        let preds: Vec<_> =
            task_node_index_graph.neighbors_directed(pruned, Direction::Incoming).collect();
        let succs: Vec<_> =
            task_node_index_graph.neighbors_directed(pruned, Direction::Outgoing).collect();
        for &pred in &preds {
            for &succ in &succs {
                if let (Some(&pe), Some(&se)) = (
                    execution_node_indices_by_task_index.get(&pred),
                    execution_node_indices_by_task_index.get(&succ),
                ) {
                    inner_graph.add_edge(pe, se, ());
                }
            }
        }
    }

    // Validate the graph is acyclic.
    // `try_from_graph` performs a DFS; if a cycle is found, it returns
    // `CycleError` containing the full cycle path as node indices.
    ExecutionGraph::try_from_graph(inner_graph).map_err(|cycle| {
        // Map each execution node index in the cycle path to its human-readable TaskDisplay.
        // Every node in the cycle was added via `inner_graph.add_node()` above,
        // with a corresponding entry in `execution_node_indices_by_task_index`.
        let displays = cycle
            .cycle_path()
            .iter()
            .map(|&exec_idx| {
                execution_node_indices_by_task_index
                    .iter()
                    .find_map(|(task_idx, &mapped_exec_idx)| {
                        if mapped_exec_idx == exec_idx {
                            Some(context.indexed_task_graph().display_task(*task_idx))
                        } else {
                            None
                        }
                    })
                    .expect("cycle node must exist in execution_node_indices_by_task_index")
            })
            .collect();
        Error::CycleDependencyDetected(displays)
    })
}
