mod cache;
mod event;
mod execute;
pub(crate) mod reporter;

// Re-export types that are part of the public API
use std::{ffi::OsStr, fmt::Debug, io::IsTerminal, sync::Arc};

use cache::ExecutionCache;
pub use cache::{CacheMiss, FingerprintMismatch};
use clap::Parser as _;
use once_cell::sync::OnceCell;
pub use reporter::ExitStatus;
use reporter::{
    GroupedReporterBuilder, InterleavedReporterBuilder, LabeledReporterBuilder,
    SummaryReporterBuilder,
    summary::{LastRunSummary, ReadSummaryError, format_full_summary},
};
use rustc_hash::FxHashMap;
use vite_path::{AbsolutePath, AbsolutePathBuf};
use vite_select::SelectItem;
use vite_str::Str;
use vite_task_graph::{
    IndexedTaskGraph, TaskGraph, TaskGraphLoadError, config::user::UserCacheConfig,
    loader::UserConfigLoader, query::TaskQuery,
};
use vite_task_plan::{
    ExecutionGraph, TaskGraphLoader,
    plan_request::{
        PlanOptions, PlanRequest, QueryPlanRequest, ScriptCommand, SyntheticPlanRequest,
    },
    prepend_path_env,
};
use vite_workspace::{WorkspaceRoot, find_workspace_root, package_graph::PackageQuery};

use crate::cli::{CacheSubcommand, Command, ResolvedCommand, ResolvedRunCommand, RunCommand};

/// Error type for [`Session::main`].
///
/// `EarlyExit` represents a non-error exit (e.g. printing a task list) and
/// the caller should exit with the contained status without printing an error.
/// It exists only for easier `?` control flow.
enum SessionError {
    Anyhow(anyhow::Error),
    EarlyExit(ExitStatus),
}

impl<T> From<T> for SessionError
where
    anyhow::Error: From<T>,
{
    fn from(err: T) -> Self {
        Self::Anyhow(anyhow::Error::from(err))
    }
}

#[derive(Debug)]
enum LazyTaskGraph<'a> {
    Uninitialized { workspace_root: WorkspaceRoot, config_loader: &'a dyn UserConfigLoader },
    Initialized(IndexedTaskGraph),
}

#[async_trait::async_trait(?Send)]
impl TaskGraphLoader for LazyTaskGraph<'_> {
    async fn load_task_graph(
        &mut self,
    ) -> Result<&vite_task_graph::IndexedTaskGraph, TaskGraphLoadError> {
        let _span = tracing::debug_span!("load_task_graph").entered();
        Ok(match self {
            Self::Uninitialized { workspace_root, config_loader } => {
                let graph = IndexedTaskGraph::load(workspace_root, *config_loader).await?;
                *self = Self::Initialized(graph);
                match self {
                    Self::Initialized(graph) => &*graph,
                    Self::Uninitialized { .. } => unreachable!(),
                }
            }
            Self::Initialized(graph) => &*graph,
        })
    }
}

pub struct SessionConfig<'a> {
    pub command_handler: &'a mut (dyn CommandHandler + 'a),
    pub user_config_loader: &'a mut (dyn UserConfigLoader + 'a),
    pub program_name: Str,
}

/// The result of a [`CommandHandler::handle_command`] call.
#[derive(Debug)]
pub enum HandledCommand {
    /// The command was synthesized into a task (e.g., `vp lint` → `oxlint`).
    Synthesized(SyntheticPlanRequest),
    /// The command is a vite task CLI command (e.g., `vp run build`).
    ViteTaskCommand(Command),
    /// The command should be executed verbatim as an external process.
    Verbatim,
}

/// Handles commands found in task scripts to determine how they should be executed.
///
/// The implementation should return:
/// - [`HandledCommand::Synthesized`] to replace the command with a synthetic task.
/// - [`HandledCommand::ViteTaskCommand`] when the command is a vite task CLI invocation.
/// - [`HandledCommand::Verbatim`] to execute the command as-is as an external process.
#[async_trait::async_trait(?Send)]
pub trait CommandHandler: Debug {
    /// Called for every command in task scripts to determine how it should be handled.
    async fn handle_command(
        &mut self,
        command: &mut ScriptCommand,
    ) -> anyhow::Result<HandledCommand>;
}

#[derive(derive_more::Debug)]
struct PlanRequestParser<'a> {
    command_handler: &'a mut (dyn CommandHandler + 'a),
}

#[async_trait::async_trait(?Send)]
impl vite_task_plan::PlanRequestParser for PlanRequestParser<'_> {
    async fn get_plan_request(
        &mut self,
        command: &mut ScriptCommand,
    ) -> anyhow::Result<Option<PlanRequest>> {
        match self.command_handler.handle_command(command).await? {
            HandledCommand::Synthesized(synthetic) => Ok(Some(PlanRequest::Synthetic(synthetic))),
            HandledCommand::ViteTaskCommand(cli_command) => match cli_command.into_resolved() {
                ResolvedCommand::Cache { .. } | ResolvedCommand::RunLastDetails => {
                    Ok(Some(PlanRequest::Synthetic(
                        command.to_synthetic_plan_request(UserCacheConfig::disabled()),
                    )))
                }
                ResolvedCommand::Run(run_command) => {
                    match run_command.into_query_plan_request(&command.cwd) {
                        Ok((query_plan_request, _)) => {
                            Ok(Some(PlanRequest::Query(query_plan_request)))
                        }
                        Err(crate::cli::CLITaskQueryError::MissingTaskSpecifier) => {
                            Ok(Some(PlanRequest::Synthetic(
                                command.to_synthetic_plan_request(UserCacheConfig::disabled()),
                            )))
                        }
                        Err(err) => Err(err.into()),
                    }
                }
            },
            HandledCommand::Verbatim => Ok(None),
        }
    }
}

/// Represents a vite task session for planning and executing tasks. A process typically has one session.
///
/// A session manages task graph loading internally and provides non-consuming methods to plan and/or execute tasks (allows multiple plans/executions per session).
pub struct Session<'a> {
    workspace_path: Arc<AbsolutePath>,
    /// A session doesn't necessarily load the task graph immediately.
    /// The task graph is loaded on-demand and cached for future use.
    lazy_task_graph: LazyTaskGraph<'a>,

    envs: Arc<FxHashMap<Arc<OsStr>, Arc<OsStr>>>,
    cwd: Arc<AbsolutePath>,

    plan_request_parser: PlanRequestParser<'a>,

    program_name: Str,

    /// Cache is lazily initialized to avoid `SQLite` race conditions when multiple
    /// processes (e.g., parallel `vt lib` commands) start simultaneously.
    cache: OnceCell<ExecutionCache>,
    cache_path: AbsolutePathBuf,
}

fn get_cache_path_of_workspace(workspace_root: &AbsolutePath) -> AbsolutePathBuf {
    std::env::var("VITE_CACHE_PATH").map_or_else(
        |_| workspace_root.join("node_modules/.vite/task-cache"),
        |env_cache_path| {
            AbsolutePathBuf::new(env_cache_path.into()).expect("Cache path should be absolute")
        },
    )
}

impl<'a> Session<'a> {
    /// Initialize a session with real environment variables and cwd
    ///
    /// # Errors
    ///
    /// Returns an error if the current directory cannot be determined or
    /// if workspace initialization fails.
    #[tracing::instrument(level = "debug", skip_all)]
    pub fn init(config: SessionConfig<'a>) -> anyhow::Result<Self> {
        let envs = std::env::vars_os()
            .map(|(k, v)| (Arc::<OsStr>::from(k.as_os_str()), Arc::<OsStr>::from(v.as_os_str())))
            .collect();
        Self::init_with(envs, vite_path::current_dir()?.into(), config)
    }

    /// Ensures the task graph is loaded, loading it if necessary.
    ///
    /// # Errors
    ///
    /// Returns an error if the task graph cannot be loaded from the workspace configuration.
    #[tracing::instrument(level = "debug", skip_all)]
    pub async fn ensure_task_graph_loaded(
        &mut self,
    ) -> Result<&IndexedTaskGraph, TaskGraphLoadError> {
        self.lazy_task_graph.load_task_graph().await
    }

    /// Initialize a session with custom cwd, environment variables. Useful for testing.
    ///
    /// # Errors
    ///
    /// Returns an error if workspace root cannot be found or PATH env cannot be prepended.
    #[tracing::instrument(level = "debug", skip_all)]
    pub fn init_with(
        mut envs: FxHashMap<Arc<OsStr>, Arc<OsStr>>,
        cwd: Arc<AbsolutePath>,
        config: SessionConfig<'a>,
    ) -> anyhow::Result<Self> {
        let (workspace_root, _) = find_workspace_root(&cwd)?;
        let cache_path = get_cache_path_of_workspace(&workspace_root.path);

        // Prepend workspace's node_modules/.bin to PATH
        let workspace_node_modules_bin = workspace_root.path.join("node_modules").join(".bin");
        prepend_path_env(&mut envs, &workspace_node_modules_bin)?;

        // Cache is lazily initialized on first access to avoid SQLite race conditions
        Ok(Self {
            workspace_path: Arc::clone(&workspace_root.path),
            lazy_task_graph: LazyTaskGraph::Uninitialized {
                workspace_root,
                config_loader: config.user_config_loader,
            },
            envs: Arc::new(envs),
            cwd,
            plan_request_parser: PlanRequestParser { command_handler: config.command_handler },
            program_name: config.program_name,
            cache: OnceCell::new(),
            cache_path,
        })
    }

    /// Primary entry point for CLI usage. Plans and executes the given command.
    ///
    /// # Errors
    ///
    /// Returns an error if planning or execution fails.
    #[tracing::instrument(level = "debug", skip_all)]
    pub async fn main(mut self, command: Command) -> anyhow::Result<ExitStatus> {
        match self.main_inner(command).await {
            Ok(()) => Ok(ExitStatus::SUCCESS),
            Err(SessionError::EarlyExit(status)) => Ok(status),
            Err(SessionError::Anyhow(err)) => Err(err),
        }
    }

    /// # Panics
    ///
    /// Panics if parsing a hardcoded bare `RunCommand` fails (should never happen).
    async fn main_inner(&mut self, command: Command) -> Result<(), SessionError> {
        match command.into_resolved() {
            ResolvedCommand::Cache { ref subcmd } => self.handle_cache_command(subcmd),
            ResolvedCommand::RunLastDetails => self.show_last_run_details(),
            ResolvedCommand::Run(run_command) => {
                let is_interactive =
                    std::io::stdin().is_terminal() && std::io::stdout().is_terminal();

                let graph = if let Some(ref task_specifier) = run_command.task_specifier {
                    // Task specifier provided — plan it.
                    let cwd = Arc::clone(&self.cwd);
                    let (graph, is_cwd_only) =
                        self.plan_from_cli_run_resolved(cwd, run_command.clone()).await?;

                    if graph.node_count() == 0 {
                        // No tasks matched. With is_cwd_only (no scope flags) the
                        // task name is a typo — show the selector. Otherwise error.
                        if is_cwd_only {
                            let qpr = self.handle_no_task(is_interactive, &run_command).await?;
                            self.plan_from_query(qpr).await?
                        } else {
                            return Err(vite_task_plan::Error::NoTasksMatched(
                                task_specifier.clone(),
                            )
                            .into());
                        }
                    } else {
                        graph
                    }
                } else {
                    // No task specifier (e.g. `vp run` or `vp run --verbose`).
                    // Only bare `vp run` enters the selector; with extra flags, error.
                    let bare = RunCommand::try_parse_from::<_, &str>([])
                        .expect("parsing hardcoded bare command should never fail")
                        .into_resolved();
                    if run_command != bare {
                        return Err(vite_task_plan::Error::MissingTaskSpecifier.into());
                    }
                    let qpr = self.handle_no_task(is_interactive, &run_command).await?;
                    self.plan_from_query(qpr).await?
                };

                let workspace_path = self.workspace_path();
                let writer: Box<dyn std::io::Write> = Box::new(std::io::stdout());

                let inner: Box<dyn reporter::GraphExecutionReporterBuilder> =
                    match run_command.flags.log {
                        crate::cli::LogMode::Interleaved => Box::new(
                            InterleavedReporterBuilder::new(Arc::clone(&workspace_path), writer),
                        ),
                        crate::cli::LogMode::Labeled => Box::new(LabeledReporterBuilder::new(
                            Arc::clone(&workspace_path),
                            writer,
                        )),
                        crate::cli::LogMode::Grouped => Box::new(GroupedReporterBuilder::new(
                            Arc::clone(&workspace_path),
                            writer,
                        )),
                    };

                let builder = Box::new(SummaryReporterBuilder::new(
                    inner,
                    workspace_path,
                    Box::new(std::io::stdout()),
                    run_command.flags.verbose,
                    Some(self.make_summary_writer()),
                    self.program_name.clone(),
                ));
                self.execute_graph(graph, builder).await.map_err(SessionError::EarlyExit)
            }
        }
    }

    fn handle_cache_command(&self, subcmd: &CacheSubcommand) -> Result<(), SessionError> {
        match subcmd {
            CacheSubcommand::Clean => {
                if self.cache_path.as_path().exists() {
                    std::fs::remove_dir_all(&self.cache_path)?;
                }
            }
        }
        Ok(())
    }

    /// Show the task selector or list, and return a plan request for the selected task.
    ///
    /// In interactive mode, shows a fuzzy-searchable selection list. On selection,
    /// returns `Ok(QueryPlanRequest)` using the selected entry's filesystem path
    /// (not its display name) for package matching.
    ///
    /// In non-interactive mode, prints the task list (or "did you mean" suggestions)
    /// and returns `Err(SessionError::EarlyExit(_))` — no further execution needed.
    #[expect(
        clippy::too_many_lines,
        reason = "builds interactive/non-interactive select items and handles selection"
    )]
    async fn handle_no_task(
        &mut self,
        is_interactive: bool,
        run_command: &ResolvedRunCommand,
    ) -> Result<QueryPlanRequest, SessionError> {
        let not_found_name = run_command.task_specifier.as_deref();
        let cwd = Arc::clone(&self.cwd);
        let task_graph = self.ensure_task_graph_loaded().await?;
        let current_package_path = task_graph.get_package_path_from_cwd(&cwd).cloned();
        let mut entries = task_graph.list_tasks();
        entries.sort_unstable_by(|a, b| {
            a.task_display
                .package_name
                .cmp(&b.task_display.package_name)
                .then_with(|| a.task_display.task_name.cmp(&b.task_display.task_name))
        });

        let workspace_path = self.workspace_path();

        // Build items: current package tasks use unqualified names (no '#'),
        // other packages use qualified "package#task" names.
        // Interactive mode uses tree view (grouped by package); non-interactive is flat.
        let select_items: Vec<SelectItem> = entries
            .iter()
            .map(|entry| {
                let is_current =
                    current_package_path.as_ref() == Some(&entry.task_display.package_path);
                let label = if is_current {
                    entry.task_display.task_name.clone()
                } else {
                    vite_str::format!("{}", entry.task_display)
                };

                let group = if is_current {
                    None
                } else {
                    let rel_path = entry
                        .task_display
                        .package_path
                        .strip_prefix(&*workspace_path)
                        .ok()
                        .flatten()
                        .map(|p| Str::from(p.as_str()))
                        .unwrap_or_default();
                    let pkg_name = &entry.task_display.package_name;
                    let display_path =
                        if rel_path.is_empty() { Str::from("workspace root") } else { rel_path };
                    Some(if pkg_name.is_empty() {
                        display_path
                    } else {
                        vite_str::format!("{pkg_name} ({display_path})")
                    })
                };
                let display_name = if is_interactive {
                    entry.task_display.task_name.clone()
                } else {
                    label.clone()
                };
                SelectItem { label, display_name, description: entry.command.clone(), group }
            })
            .collect();

        // Build header: interactive says "not found.", non-interactive adds
        // "Did you mean:" suffix only when there are fuzzy matches to show.
        let header = not_found_name.map(|name| {
            if is_interactive {
                vite_str::format!("Task \"{name}\" not found.")
            } else {
                let labels: Vec<&str> =
                    select_items.iter().map(|item| item.label.as_str()).collect();
                let has_suggestions = !vite_select::fuzzy_match(name, &labels).is_empty();
                if has_suggestions {
                    vite_str::format!("Task \"{name}\" not found. Did you mean:")
                } else {
                    vite_str::format!("Task \"{name}\" not found.")
                }
            }
        });

        // Build mode-dependent params and call select_list once
        let mut selected_index = if is_interactive { Some(0) } else { None };
        let mut stdout = std::io::stdout();
        let mode =
            selected_index.as_mut().map_or(vite_select::Mode::NonInteractive, |selected_index| {
                vite_select::Mode::Interactive { selected_index }
            });

        let params = vite_select::SelectParams {
            items: &select_items,
            query: not_found_name,
            header: header.as_deref(),
            page_size: 12,
        };

        vite_select::select_list(&mut stdout, &params, mode, |state| {
            use std::io::Write;
            let milestone_name =
                vite_str::format!("task-select:{}:{}", state.query, state.selected_index);
            let milestone_bytes = pty_terminal_test_client::encoded_milestone(&milestone_name);
            let mut out = std::io::stdout();
            let _ = out.write_all(&milestone_bytes);
            let _ = out.flush();
        })?;

        let Some(selected_index) = selected_index else {
            // Non-interactive, the list was printed.
            return Err(SessionError::EarlyExit(if not_found_name.is_some() {
                // For `vp run typo`, return FAILURE status
                ExitStatus::FAILURE
            } else {
                // For bare `vp run`, return SUCCESS status
                ExitStatus::SUCCESS
            }));
        };

        // Interactive: print selected task and build a QueryPlanRequest using the
        // entry's filesystem path (not its display name) for package matching.
        let entry = &entries[selected_index];
        let selected_label = &select_items[selected_index].label;
        {
            use std::io::Write as _;

            use owo_colors::{OwoColorize as _, Stream};
            writeln!(
                stdout,
                "{}{}",
                "Selected task: ".if_supports_color(Stream::Stdout, |s| s.bold()),
                selected_label,
            )?;
        }

        let package_query =
            PackageQuery::containing_package(Arc::clone(&entry.task_display.package_path));
        Ok(QueryPlanRequest {
            query: TaskQuery {
                package_query,
                task_name: entry.task_display.task_name.clone(),
                include_explicit_deps: !run_command.flags.ignore_depends_on,
            },
            plan_options: PlanOptions {
                extra_args: run_command.additional_args.clone().into(),
                cache_override: run_command.flags.cache_override(),
            },
        })
    }

    /// Lazily initializes and returns the execution cache.
    /// The cache is only created when first accessed to avoid `SQLite` race conditions
    /// when multiple processes start simultaneously.
    ///
    /// # Errors
    ///
    /// Returns an error if the cache database cannot be loaded or created.
    pub fn cache(&self) -> anyhow::Result<&ExecutionCache> {
        self.cache.get_or_try_init(|| ExecutionCache::load_from_path(&self.cache_path))
    }

    pub fn workspace_path(&self) -> Arc<AbsolutePath> {
        Arc::clone(&self.workspace_path)
    }

    /// Path to the `last-summary.json` file inside the cache directory.
    fn summary_file_path(&self) -> AbsolutePathBuf {
        self.cache_path.join("last-summary.json")
    }

    /// Create a callback that persists the summary to `last-summary.json`.
    ///
    /// The returned closure captures the file path and handles errors internally
    /// (logging failures without propagating).
    fn make_summary_writer(&self) -> Box<dyn FnOnce(&LastRunSummary)> {
        let path = self.summary_file_path();
        Box::new(move |summary: &LastRunSummary| {
            if let Err(err) = summary.write_atomic(&path) {
                tracing::warn!("Failed to write summary to {path:?}: {err}");
            }
        })
    }

    /// Display the saved summary from the last run (`--last-details`).
    #[expect(
        clippy::print_stderr,
        reason = "--last-details error messages are user-facing diagnostics, not debug output"
    )]
    fn show_last_run_details(&self) -> Result<(), SessionError> {
        let path = self.summary_file_path();
        match LastRunSummary::read_from_path(&path) {
            Ok(Some(summary)) => {
                let buf = format_full_summary(&summary);
                {
                    use std::io::Write;
                    let mut stdout = std::io::stdout().lock();
                    stdout.write_all(&buf)?;
                    stdout.flush()?;
                }
                Err(SessionError::EarlyExit(ExitStatus(summary.exit_code)))
            }
            Ok(None) => {
                eprintln!("No previous run summary found. Run a task first to generate a summary.");
                Err(SessionError::EarlyExit(ExitStatus::FAILURE))
            }
            Err(ReadSummaryError::IncompatibleVersion) => {
                eprintln!(
                    "Summary data was saved by a different version of vite-task and cannot be read. \
                     Run a task to generate a new summary."
                );
                Err(SessionError::EarlyExit(ExitStatus::FAILURE))
            }
            Err(ReadSummaryError::Io(err)) => Err(err.into()),
        }
    }

    pub const fn task_graph(&self) -> Option<&TaskGraph> {
        match &self.lazy_task_graph {
            LazyTaskGraph::Initialized(graph) => Some(graph.task_graph()),
            LazyTaskGraph::Uninitialized { .. } => None,
        }
    }

    pub const fn envs(&self) -> &Arc<FxHashMap<Arc<OsStr>, Arc<OsStr>>> {
        &self.envs
    }

    pub const fn cwd(&self) -> &Arc<AbsolutePath> {
        &self.cwd
    }

    /// Execute a synthetic command with cache support.
    ///
    /// This is for executing a single command with cache before/without the entrypoint
    /// [`Session::main`]. In vite-plus, this is used for auto-install.
    ///
    /// Unlike `execute_graph` which uses the full graph reporter
    /// pipeline, this method uses a `PlainReporter` — a lightweight reporter with no
    /// summary, no stats tracking, and no graph awareness.
    ///
    /// The exit status is determined from the `execute_spawn` return value, not from
    /// the reporter.
    ///
    /// # Errors
    ///
    /// Returns an error if planning or execution of the synthetic command fails.
    #[tracing::instrument(level = "debug", skip_all)]
    #[expect(
        clippy::large_futures,
        reason = "execution plan future is large but only awaited once"
    )]
    pub async fn execute_synthetic(
        &self,
        synthetic_plan_request: SyntheticPlanRequest,
        cache_key: Arc<[Str]>,
        silent_if_cache_hit: bool,
    ) -> anyhow::Result<ExitStatus> {
        // Plan the synthetic execution — returns a SpawnExecution directly
        // (synthetic plans are always a single spawned process)
        let spawn_execution = vite_task_plan::plan_synthetic(
            &self.workspace_path,
            &self.cwd,
            synthetic_plan_request,
            cache_key,
        )?;

        // Initialize cache (needed for cache-aware execution)
        let cache = self.cache()?;

        // Create a plain (standalone) reporter — no graph awareness, no summary
        let plain_reporter =
            reporter::PlainReporter::new(silent_if_cache_hit, Box::new(std::io::stdout()));

        // Execute the spawn directly using the free function, bypassing the graph pipeline
        let outcome = execute::execute_spawn(
            Box::new(plain_reporter),
            &spawn_execution,
            cache,
            &self.workspace_path,
        )
        .await;
        match outcome {
            // Cache hit — no process was spawned, success
            execute::SpawnOutcome::CacheHit => Ok(ExitStatus::SUCCESS),
            // Process ran successfully
            execute::SpawnOutcome::Spawned(status) if status.success() => Ok(ExitStatus::SUCCESS),
            // Process ran but exited with non-zero status
            execute::SpawnOutcome::Spawned(status) => {
                let code = event::exit_status_to_code(status);
                #[expect(
                    clippy::cast_sign_loss,
                    reason = "value is clamped to 1..=255, always positive"
                )]
                Ok(ExitStatus(code.clamp(1, 255) as u8))
            }
            // Infrastructure error — already reported through the reporter's finish()
            execute::SpawnOutcome::Failed => Ok(ExitStatus::FAILURE),
        }
    }

    /// Plans execution from a CLI run command.
    ///
    /// # Errors
    ///
    /// Returns an error if the plan request cannot be parsed or if planning fails.
    #[tracing::instrument(level = "debug", skip_all)]
    pub async fn plan_from_cli_run(
        &mut self,
        cwd: Arc<AbsolutePath>,
        command: RunCommand,
    ) -> Result<ExecutionGraph, vite_task_plan::Error> {
        let (graph, _) = self.plan_from_cli_run_resolved(cwd, command.into_resolved()).await?;
        Ok(graph)
    }

    /// Internal: plans execution from a resolved run command.
    #[tracing::instrument(level = "debug", skip_all)]
    async fn plan_from_cli_run_resolved(
        &mut self,
        cwd: Arc<AbsolutePath>,
        command: crate::cli::ResolvedRunCommand,
    ) -> Result<(ExecutionGraph, bool), vite_task_plan::Error> {
        let (query_plan_request, is_cwd_only) = match command.into_query_plan_request(&cwd) {
            Ok(result) => result,
            Err(crate::cli::CLITaskQueryError::MissingTaskSpecifier) => {
                return Err(vite_task_plan::Error::MissingTaskSpecifier);
            }
            Err(error) => {
                return Err(vite_task_plan::Error::ParsePlanRequest {
                    error: error.into(),
                    program: self.program_name.clone(),
                    args: Arc::default(),
                    cwd: Arc::clone(&cwd),
                });
            }
        };
        let graph = vite_task_plan::plan_query(
            query_plan_request,
            &self.workspace_path,
            &cwd,
            &self.envs,
            &mut self.plan_request_parser,
            &mut self.lazy_task_graph,
        )
        .await?;
        Ok((graph, is_cwd_only))
    }

    /// Plan execution from a pre-built [`QueryPlanRequest`].
    ///
    /// Used by the interactive task selector, which constructs the request
    /// directly (bypassing CLI specifier parsing).
    async fn plan_from_query(
        &mut self,
        request: QueryPlanRequest,
    ) -> Result<ExecutionGraph, vite_task_plan::Error> {
        let cwd = Arc::clone(&self.cwd);
        vite_task_plan::plan_query(
            request,
            &self.workspace_path,
            &cwd,
            &self.envs,
            &mut self.plan_request_parser,
            &mut self.lazy_task_graph,
        )
        .await
    }
}
