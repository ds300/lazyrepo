pub mod fingerprint;
pub mod glob_inputs;
pub mod spawn;

use std::{collections::BTreeMap, io::Write as _, process::Stdio, sync::Arc};

use futures_util::FutureExt;
use vite_path::AbsolutePath;
use vite_task_plan::{
    ExecutionGraph, ExecutionItemDisplay, ExecutionItemKind, LeafExecutionKind, SpawnCommand,
    SpawnExecution,
};

use self::{
    fingerprint::PostRunFingerprint,
    glob_inputs::compute_globbed_inputs,
    spawn::{SpawnResult, TrackedPathAccesses, spawn_with_tracking},
};
use super::{
    cache::{CacheEntryValue, ExecutionCache},
    event::{
        CacheDisabledReason, CacheErrorKind, CacheNotUpdatedReason, CacheStatus, CacheUpdateStatus,
        ExecutionError,
    },
    reporter::{
        ExitStatus, GraphExecutionReporter, GraphExecutionReporterBuilder, LeafExecutionReporter,
        StdioSuggestion,
    },
};
use crate::{Session, collections::HashMap};

/// Outcome of a spawned execution.
///
/// Returned by [`execute_spawn`] to communicate what happened. Errors are
/// already reported through `LeafExecutionReporter::finish()` before this
/// value is returned — the caller does not need to handle error display.
pub enum SpawnOutcome {
    /// Cache hit — no process was spawned. Cached outputs were replayed.
    CacheHit,
    /// Process was spawned and exited with this status.
    Spawned(std::process::ExitStatus),
    /// An infrastructure error prevented the process from running
    /// (cache lookup failure or spawn failure).
    /// Already reported through the leaf reporter.
    Failed,
}

/// Holds mutable references needed during graph execution.
///
/// The `reporter` field is used to create leaf reporters for individual executions.
/// Cache fields are passed through to [`execute_spawn`] for cache-aware execution.
struct ExecutionContext<'a> {
    /// The graph-level reporter, used to create leaf reporters via `new_leaf_execution()`.
    reporter: &'a mut dyn GraphExecutionReporter,
    /// The execution cache for looking up and storing cached results.
    cache: &'a ExecutionCache,
    /// Base path for resolving relative paths in cache entries.
    /// Typically the workspace root.
    cache_base_path: &'a Arc<AbsolutePath>,
}

impl ExecutionContext<'_> {
    /// Execute all tasks in an execution graph in dependency order.
    ///
    /// `ExecutionGraph` guarantees acyclicity at construction time.
    /// We compute a topological order and iterate in reverse to get execution order
    /// (dependencies before dependents).
    ///
    /// Fast-fail: if any task fails (non-zero exit or infrastructure error), remaining
    /// tasks and `&&`-chained items are skipped. Leaf-level errors are reported through
    /// the reporter. Cycle detection is handled at plan time.
    ///
    /// Returns `true` if all tasks succeeded, `false` if any task failed.
    #[tracing::instrument(level = "debug", skip_all)]
    async fn execute_expanded_graph(&mut self, graph: &ExecutionGraph) -> bool {
        // `compute_topological_order()` returns nodes in topological order: for every
        // edge A→B, A appears before B. Since our edges mean "A depends on B",
        // dependencies (B) appear after their dependents (A). We iterate in reverse
        // to get execution order where dependencies run first.

        // Execute tasks in dependency-first order. Each task may have multiple items
        // (from `&&`-split commands), which are executed sequentially.
        // If any task fails, subsequent tasks and items are skipped (fast-fail).
        let topo_order = graph.compute_topological_order();
        for &node_ix in topo_order.iter().rev() {
            let task_execution = &graph[node_ix];

            for item in &task_execution.items {
                let failed = match &item.kind {
                    ExecutionItemKind::Leaf(leaf_kind) => {
                        self.execute_leaf(&item.execution_item_display, leaf_kind)
                            .boxed_local()
                            .await
                    }
                    ExecutionItemKind::Expanded(nested_graph) => {
                        !self.execute_expanded_graph(nested_graph).boxed_local().await
                    }
                };
                if failed {
                    return false;
                }
            }
        }
        true
    }

    /// Execute a single leaf item (in-process command or spawned process).
    ///
    /// Creates a [`LeafExecutionReporter`] from the graph reporter and delegates
    /// to the appropriate execution method.
    ///
    /// Returns `true` if the execution failed (non-zero exit or infrastructure error).
    #[tracing::instrument(level = "debug", skip_all)]
    async fn execute_leaf(
        &mut self,
        display: &ExecutionItemDisplay,
        leaf_kind: &LeafExecutionKind,
    ) -> bool {
        let mut leaf_reporter = self.reporter.new_leaf_execution(display, leaf_kind);

        match leaf_kind {
            LeafExecutionKind::InProcess(in_process_execution) => {
                // In-process (built-in) commands: caching is disabled, execute synchronously
                let mut stdio_config = leaf_reporter
                    .start(CacheStatus::Disabled(CacheDisabledReason::InProcessExecution));

                let execution_output = in_process_execution.execute();
                // Write output to the stdout writer from StdioConfig
                let _ = stdio_config.stdout_writer.write_all(&execution_output.stdout);
                let _ = stdio_config.stdout_writer.flush();

                leaf_reporter.finish(
                    None,
                    CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                    None,
                );
                false
            }
            LeafExecutionKind::Spawn(spawn_execution) => {
                #[expect(
                    clippy::large_futures,
                    reason = "spawn execution with cache management creates large futures"
                )]
                let outcome =
                    execute_spawn(leaf_reporter, spawn_execution, self.cache, self.cache_base_path)
                        .await;
                match outcome {
                    SpawnOutcome::CacheHit => false,
                    SpawnOutcome::Spawned(status) => !status.success(),
                    SpawnOutcome::Failed => true,
                }
            }
        }
    }
}

/// Execute a spawned process with cache-aware lifecycle.
///
/// This is a free function (not tied to `ExecutionContext`) so it can be reused
/// from both graph-based execution and standalone synthetic execution.
///
/// The full lifecycle is:
/// 1. Cache lookup (determines cache status)
/// 2. `leaf_reporter.start(cache_status)` → `StdioConfig`
/// 3. If cache hit: replay cached outputs via `StdioConfig` writers → finish
/// 4. If `Inherited` suggestion AND caching disabled: `spawn_inherited()` → finish
/// 5. Else (piped): `spawn_with_tracking()` with writers → cache update → finish
///
/// Errors (cache lookup failure, spawn failure, cache update failure) are reported
/// through `leaf_reporter.finish()` and do not abort the caller.
#[tracing::instrument(level = "debug", skip_all)]
#[expect(
    clippy::too_many_lines,
    reason = "sequential cache check, execute, and update steps are clearer in one function"
)]
pub async fn execute_spawn(
    mut leaf_reporter: Box<dyn LeafExecutionReporter>,
    spawn_execution: &SpawnExecution,
    cache: &ExecutionCache,
    cache_base_path: &Arc<AbsolutePath>,
) -> SpawnOutcome {
    let cache_metadata = spawn_execution.cache_metadata.as_ref();

    // 1. Determine cache status FIRST by trying cache hit.
    //    We need to know the status before calling start() so the reporter
    //    can display cache status immediately when execution begins.
    let (cache_status, cached_value, globbed_inputs) = if let Some(cache_metadata) = cache_metadata
    {
        // Compute globbed inputs from positive globs at execution time
        // Globs are already workspace-root-relative (resolved at task graph stage)
        let globbed_inputs = match compute_globbed_inputs(
            cache_base_path,
            &cache_metadata.input_config.positive_globs,
            &cache_metadata.input_config.negative_globs,
        ) {
            Ok(inputs) => inputs,
            Err(err) => {
                leaf_reporter.finish(
                    None,
                    CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                    Some(ExecutionError::Cache { kind: CacheErrorKind::Lookup, source: err }),
                );
                return SpawnOutcome::Failed;
            }
        };

        match cache.try_hit(cache_metadata, &globbed_inputs, cache_base_path).await {
            Ok(Ok(cached)) => (
                // Cache hit — we can replay the cached outputs
                CacheStatus::Hit { replayed_duration: cached.duration },
                Some(cached),
                globbed_inputs,
            ),
            Ok(Err(cache_miss)) => (
                // Cache miss — includes detailed reason (NotFound or FingerprintMismatch)
                CacheStatus::Miss(cache_miss),
                None,
                globbed_inputs,
            ),
            Err(err) => {
                // Cache lookup error — report through finish.
                // Note: start() is NOT called because we don't have a valid cache status.
                leaf_reporter.finish(
                    None,
                    CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                    Some(ExecutionError::Cache { kind: CacheErrorKind::Lookup, source: err }),
                );
                return SpawnOutcome::Failed;
            }
        }
    } else {
        // No cache metadata provided — caching is disabled for this task
        (CacheStatus::Disabled(CacheDisabledReason::NoCacheMetadata), None, BTreeMap::new())
    };

    // 2. Report execution start with the determined cache status.
    //    Returns StdioConfig with the reporter's suggestion and writers.
    let mut stdio_config = leaf_reporter.start(cache_status);

    // 3. If cache hit, replay outputs via the StdioConfig writers and finish early.
    //    No need to actually execute the command — just replay what was cached.
    if let Some(cached) = cached_value {
        for output in cached.std_outputs.iter() {
            let writer: &mut dyn std::io::Write = match output.kind {
                spawn::OutputKind::StdOut => &mut stdio_config.stdout_writer,
                spawn::OutputKind::StdErr => &mut stdio_config.stderr_writer,
            };
            let _ = writer.write_all(&output.content);
            let _ = writer.flush();
        }
        leaf_reporter.finish(
            None,
            CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheHit),
            None,
        );
        return SpawnOutcome::CacheHit;
    }

    // 4. Determine actual stdio mode based on the suggestion AND cache state.
    //    Inherited stdio is only used when the reporter suggests it AND caching is
    //    completely disabled (no cache_metadata). If caching is enabled but missed,
    //    we still need piped mode to capture output for the cache update.
    let use_inherited =
        stdio_config.suggestion == StdioSuggestion::Inherited && cache_metadata.is_none();

    if use_inherited {
        // Inherited mode: all three stdio FDs (stdin, stdout, stderr) are inherited
        // from the parent process. No fspy tracking, no output capture.
        // Drop the StdioConfig writers before spawning to avoid holding std::io::Stdout
        // while the child also writes to the same FD.
        drop(stdio_config);

        match spawn_inherited(&spawn_execution.spawn_command).await {
            Ok(result) => {
                leaf_reporter.finish(
                    Some(result.exit_status),
                    CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                    None,
                );
                return SpawnOutcome::Spawned(result.exit_status);
            }
            Err(err) => {
                leaf_reporter.finish(
                    None,
                    CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                    Some(ExecutionError::Spawn(err)),
                );
                return SpawnOutcome::Failed;
            }
        }
    }

    // 5. Piped mode: execute spawn with tracking, streaming output to writers.
    //    - std_outputs: always captured when caching is enabled (for cache replay)
    //    - path_accesses: only tracked when includes_auto is true (fspy inference)
    let (mut std_outputs, mut path_accesses, cache_metadata_and_inputs) =
        cache_metadata.map_or((None, None, None), |cache_metadata| {
            // On musl targets, LD_PRELOAD-based tracking is unavailable but seccomp
            // unotify provides equivalent file access tracing.
            let path_accesses = if cache_metadata.input_config.includes_auto {
                Some(TrackedPathAccesses::default())
            } else {
                None // Skip fspy when inference is disabled or unavailable
            };
            (Some(Vec::new()), path_accesses, Some((cache_metadata, globbed_inputs)))
        });

    // Build negative globs for fspy path filtering (already workspace-root-relative)
    let resolved_negatives: Vec<wax::Glob<'static>> =
        if let Some((cache_metadata, _)) = &cache_metadata_and_inputs {
            match cache_metadata
                .input_config
                .negative_globs
                .iter()
                .map(|p| Ok(wax::Glob::new(p.as_str())?.into_owned()))
                .collect::<anyhow::Result<Vec<_>>>()
            {
                Ok(negs) => negs,
                Err(err) => {
                    leaf_reporter.finish(
                        None,
                        CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                        Some(ExecutionError::PostRunFingerprint(err)),
                    );
                    return SpawnOutcome::Failed;
                }
            }
        } else {
            Vec::new()
        };

    #[expect(
        clippy::large_futures,
        reason = "spawn_with_tracking manages process I/O and creates a large future"
    )]
    let result = match spawn_with_tracking(
        &spawn_execution.spawn_command,
        cache_base_path,
        &mut *stdio_config.stdout_writer,
        &mut *stdio_config.stderr_writer,
        std_outputs.as_mut(),
        path_accesses.as_mut(),
        &resolved_negatives,
    )
    .await
    {
        Ok(result) => result,
        Err(err) => {
            leaf_reporter.finish(
                None,
                CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                Some(ExecutionError::Spawn(err)),
            );
            return SpawnOutcome::Failed;
        }
    };

    // 6. Update cache if successful and determine cache update status.
    //    Errors during cache update are terminal (reported through finish).
    let (cache_update_status, cache_error) = if let Some((cache_metadata, globbed_inputs)) =
        cache_metadata_and_inputs
    {
        if result.exit_status.success() {
            // Check for read-write overlap: if the task wrote to any file it also
            // read, the inputs were modified during execution — don't cache.
            // Note: this only checks fspy-inferred reads, not globbed_inputs keys.
            // A task that writes to a glob-matched file without reading it causes
            // perpetual cache misses (glob detects the hash change) but not a
            // correctness bug, so we don't handle that case here.
            if let Some(path) = path_accesses
                .as_ref()
                .and_then(|pa| pa.path_reads.keys().find(|p| pa.path_writes.contains(*p)))
            {
                (
                    CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::InputModified {
                        path: path.clone(),
                    }),
                    None,
                )
            } else {
                // path_reads is empty when inference is disabled (path_accesses is None)
                let empty_path_reads = HashMap::default();
                let path_reads =
                    path_accesses.as_ref().map_or(&empty_path_reads, |pa| &pa.path_reads);

                // Execution succeeded — attempt to create fingerprint and update cache.
                // Paths already in globbed_inputs are skipped: Rule 1 (above) guarantees
                // no input modification, so the prerun hash is the correct post-exec hash.
                match PostRunFingerprint::create(path_reads, cache_base_path, &globbed_inputs) {
                    Ok(post_run_fingerprint) => {
                        let new_cache_value = CacheEntryValue {
                            post_run_fingerprint,
                            std_outputs: std_outputs.unwrap_or_default().into(),
                            duration: result.duration,
                            globbed_inputs,
                        };
                        match cache.update(cache_metadata, new_cache_value).await {
                            Ok(()) => (CacheUpdateStatus::Updated, None),
                            Err(err) => (
                                CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                                Some(ExecutionError::Cache {
                                    kind: CacheErrorKind::Update,
                                    source: err,
                                }),
                            ),
                        }
                    }
                    Err(err) => (
                        CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled),
                        Some(ExecutionError::PostRunFingerprint(err)),
                    ),
                }
            }
        } else {
            // Execution failed with non-zero exit status — don't update cache
            (CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::NonZeroExitStatus), None)
        }
    } else {
        // Caching was disabled for this task
        (CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::CacheDisabled), None)
    };

    // 7. Finish the leaf execution with the result and optional cache error.
    //    Cache update/fingerprint failures are reported but do not affect the outcome —
    //    the process ran, so we return its actual exit status.
    leaf_reporter.finish(Some(result.exit_status), cache_update_status, cache_error);

    SpawnOutcome::Spawned(result.exit_status)
}

/// Spawn a command with all three stdio file descriptors inherited from the parent.
///
/// Used when the reporter suggests inherited stdio AND caching is disabled.
/// All three FDs (stdin, stdout, stderr) are inherited, allowing interactive input
/// and direct terminal output. No fspy tracking is performed since there's no
/// cache to update.
///
/// The child process will see `is_terminal() == true` for stdout/stderr when the
/// parent is running in a terminal. This is expected behavior.
#[tracing::instrument(level = "debug", skip_all)]
async fn spawn_inherited(spawn_command: &SpawnCommand) -> anyhow::Result<SpawnResult> {
    let mut cmd = fspy::Command::new(spawn_command.program_path.as_path());
    cmd.args(spawn_command.args.iter().map(vite_str::Str::as_str));
    cmd.envs(spawn_command.all_envs.iter());
    cmd.current_dir(&*spawn_command.cwd);
    cmd.stdin(Stdio::inherit()).stdout(Stdio::inherit()).stderr(Stdio::inherit());

    let start = std::time::Instant::now();
    let mut tokio_cmd = cmd.into_tokio_command();

    // Clear FD_CLOEXEC on stdio fds before exec. libuv (used by Node.js) marks
    // stdin/stdout/stderr as close-on-exec, which causes them to be closed when
    // the child process calls exec(). Without this fix, the child's fds 0-2 are
    // closed after exec and Node.js reopens them as /dev/null, losing all output.
    // See: https://github.com/libuv/libuv/issues/2062
    // SAFETY: The pre_exec closure only performs fcntl operations to clear
    // FD_CLOEXEC flags on stdio fds, which is safe in a post-fork context.
    #[cfg(unix)]
    unsafe {
        tokio_cmd.pre_exec(|| {
            use std::os::fd::BorrowedFd;

            use nix::{
                fcntl::{FcntlArg, FdFlag, fcntl},
                libc::{STDERR_FILENO, STDIN_FILENO, STDOUT_FILENO},
            };
            for fd in [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO] {
                // SAFETY: fds 0-2 are always valid in a post-fork context
                let borrowed = BorrowedFd::borrow_raw(fd);
                if let Ok(flags) = fcntl(borrowed, FcntlArg::F_GETFD) {
                    let mut fd_flags = FdFlag::from_bits_retain(flags);
                    if fd_flags.contains(FdFlag::FD_CLOEXEC) {
                        fd_flags.remove(FdFlag::FD_CLOEXEC);
                        let _ = fcntl(borrowed, FcntlArg::F_SETFD(fd_flags));
                    }
                }
            }
            Ok(())
        });
    }

    let mut child = tokio_cmd.spawn()?;
    let exit_status = child.wait().await?;

    Ok(SpawnResult { exit_status, duration: start.elapsed() })
}

impl Session<'_> {
    /// Execute an execution graph, reporting events through the provided reporter builder.
    ///
    /// Cache is initialized only if any leaf execution needs it. The reporter is built
    /// after cache initialization, so cache errors are reported directly to stderr
    /// without involving the reporter at all.
    ///
    /// Returns `Err(ExitStatus)` to indicate the caller should exit with the given status code.
    /// Returns `Ok(())` when all tasks succeeded.
    #[tracing::instrument(level = "debug", skip_all)]
    pub(crate) async fn execute_graph(
        &self,
        execution_graph: ExecutionGraph,
        builder: Box<dyn GraphExecutionReporterBuilder>,
    ) -> Result<(), ExitStatus> {
        // Initialize cache before building the reporter. Cache errors are reported
        // directly to stderr and cause an early exit, keeping the reporter flow clean
        // (the reporter's `finish()` no longer accepts graph-level error messages).
        let cache = match self.cache() {
            Ok(cache) => cache,
            #[expect(clippy::print_stderr, reason = "cache init errors bypass the reporter")]
            Err(err) => {
                eprintln!("Failed to initialize cache: {err}");
                return Err(ExitStatus::FAILURE);
            }
        };

        let mut reporter = builder.build();

        let mut execution_context = ExecutionContext {
            reporter: &mut *reporter,
            cache,
            cache_base_path: &self.workspace_path,
        };

        // Execute the graph with fast-fail: if any task fails, remaining tasks
        // are skipped. Leaf-level errors are reported through the reporter.
        execution_context.execute_expanded_graph(&execution_graph).await;

        // Leaf-level errors and non-zero exit statuses are tracked internally
        // by the reporter.
        reporter.finish()
    }
}
