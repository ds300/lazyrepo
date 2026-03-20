//! Reporter traits and implementations for rendering execution events.
//!
//! This module provides a typestate-based reporter system with three phases:
//!
//! 1. [`GraphExecutionReporterBuilder`] — created before execution begins.
//!    Transitions to [`GraphExecutionReporter`] when `build()` is called.
//!
//! 2. [`GraphExecutionReporter`] — creates [`LeafExecutionReporter`]
//!    instances for individual leaf executions via `new_leaf_execution()`. Finalized with `finish()`.
//!
//! 3. [`LeafExecutionReporter`] — handles events for a single leaf execution (output streaming,
//!    cache status, errors). Finalized with `finish()`.
//!
//! Three output mode reporters are provided:
//!
//! - [`interleaved::InterleavedReporterBuilder`] — streams output directly as tasks produce it.
//! - [`labeled::LabeledReporterBuilder`] — prefixes each output line with `[pkg#task]`.
//! - [`grouped::GroupedReporterBuilder`] — buffers output per task and prints as a block.
//!
//! [`summary_reporter::SummaryReporterBuilder`] wraps any mode reporter to add summary
//! tracking (task results, exit codes, cache stats) and renders the summary at the end.
//!
//! Additionally, [`plain::PlainReporter`] is a standalone [`LeafExecutionReporter`] for
//! single-leaf synthetic executions (e.g., `execute_synthetic`).

mod grouped;
mod interleaved;
mod labeled;
mod plain;
pub mod summary;
mod summary_reporter;

use std::{io::Write, process::ExitStatus as StdExitStatus, sync::LazyLock};

pub use grouped::GroupedReporterBuilder;
pub use interleaved::InterleavedReporterBuilder;
pub use labeled::LabeledReporterBuilder;
use owo_colors::{Style, Styled};
pub use plain::PlainReporter;
pub use summary_reporter::SummaryReporterBuilder;
use vite_path::AbsolutePath;
use vite_str::Str;
use vite_task_plan::{ExecutionItemDisplay, LeafExecutionKind};

use super::{
    cache::format_cache_status_inline,
    event::{CacheStatus, CacheUpdateStatus, ExecutionError},
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Exit status type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Exit status code for task execution.
///
/// Wraps a `u8` exit code. `0` means success, non-zero means failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitStatus(pub u8);

impl ExitStatus {
    pub const FAILURE: Self = Self(1);
    pub const SUCCESS: Self = Self(0);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Stdio suggestion and configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Suggestion from the reporter about what stdio mode to use for a spawned process.
///
/// The actual stdio mode is determined by [`execute_spawn`](super::execute::execute_spawn)
/// based on this suggestion AND whether caching is enabled for the task:
/// - `Inherited` is only honoured when caching is disabled (`cache_metadata` is `None`).
///   With caching enabled, the execution engine overrides to `Piped` so that output can
///   be captured for the cache.
/// - `Piped` is always respected as-is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StdioSuggestion {
    /// stdin is `/dev/null`, stdout and stderr are piped into the reporter's
    /// [`Write`] streams.  Used when multiple tasks run concurrently and
    /// stdio should not be shared.
    Piped,
    /// All three file descriptors (stdin, stdout, stderr) are inherited from the
    /// parent process, allowing interactive input and direct terminal output.
    /// Only effective when caching is disabled for the task.
    Inherited,
}

/// Stdio configuration returned by [`LeafExecutionReporter::start`].
///
/// Contains the reporter's suggestion for the stdio mode together with two
/// writers that receive the child process's stdout and stderr when the
/// execution engine decides to use piped mode.  The writers are always provided
/// because the engine may override the suggestion (e.g. when caching forces
/// piped mode even though the reporter suggested inherited).
pub struct StdioConfig {
    /// The reporter's preferred stdio mode.
    pub suggestion: StdioSuggestion,
    /// Writer for the child process's stdout (used in piped mode and cache replay).
    pub stdout_writer: Box<dyn Write>,
    /// Writer for the child process's stderr (used in piped mode and cache replay).
    pub stderr_writer: Box<dyn Write>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Typestate traits
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Builder for creating a [`GraphExecutionReporter`].
///
/// This is the initial state before the execution graph is known. The `build` method
/// transitions to the [`GraphExecutionReporter`] phase.
pub trait GraphExecutionReporterBuilder {
    /// Create a [`GraphExecutionReporter`].
    fn build(self: Box<Self>) -> Box<dyn GraphExecutionReporter>;
}

/// Reporter for an entire graph execution session.
///
/// Creates [`LeafExecutionReporter`] instances for individual leaf executions
/// and finalizes the session with `finish()`.
pub trait GraphExecutionReporter {
    /// Create a new leaf execution reporter for the given leaf.
    fn new_leaf_execution(
        &mut self,
        display: &ExecutionItemDisplay,
        leaf_kind: &LeafExecutionKind,
    ) -> Box<dyn LeafExecutionReporter>;

    /// Finalize the graph execution session.
    ///
    /// Leaf-level errors are already tracked internally by the reporter via the
    /// leaf reporter's `finish()` method. Graph-level errors (cycle detection) are
    /// now caught at plan time and never reach the reporter.
    ///
    /// Returns `Ok(())` if all tasks succeeded, or `Err(ExitStatus)` to indicate the
    /// process should exit with the given status code.
    fn finish(self: Box<Self>) -> Result<(), ExitStatus>;
}

/// Reporter for a single leaf execution (one spawned process or in-process command).
///
/// Lifecycle: `start()` → `finish()`.
///
/// `start()` may not be called before `finish()` if an error occurs before the cache
/// status is determined (e.g., cache lookup failure).
pub trait LeafExecutionReporter {
    /// Report that execution is starting with the given cache status.
    ///
    /// Called after the cache lookup completes, before any output is produced.
    /// Returns a [`StdioConfig`] containing:
    /// - The reporter's stdio mode suggestion (inherited or piped).
    /// - Two [`Write`] streams for receiving the child's stdout and stderr
    ///   (used when the execution engine decides on piped mode, or for cache replay).
    ///
    /// The execution engine decides the actual stdio mode based on the suggestion
    /// AND whether caching is enabled — inherited stdio is only used when the
    /// suggestion is [`StdioSuggestion::Inherited`] AND the task has no cache
    /// metadata (caching disabled).
    fn start(&mut self, cache_status: CacheStatus) -> StdioConfig;

    /// Finalize this leaf execution.
    ///
    /// - `status`: The process exit status, or `None` for cache hits and in-process commands.
    /// - `cache_update_status`: Whether the cache was updated after execution.
    /// - `error`: If `Some`, an error occurred during this leaf's execution (cache lookup
    ///   failure, spawn failure, fingerprint creation failure, cache update failure).
    ///
    /// This method consumes the reporter — no further calls are possible after `finish()`.
    fn finish(
        self: Box<Self>,
        status: Option<StdExitStatus>,
        cache_update_status: CacheUpdateStatus,
        error: Option<ExecutionError>,
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared display helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Wrap of `OwoColorize` that ignores style if `NO_COLOR` is set.
trait ColorizeExt {
    fn style(&self, style: Style) -> Styled<&Self>;
}

impl<T: owo_colors::OwoColorize> ColorizeExt for T {
    fn style(&self, style: Style) -> Styled<&Self> {
        static NO_COLOR: LazyLock<bool> =
            LazyLock::new(|| std::env::var_os("NO_COLOR").is_some_and(|v| !v.is_empty()));
        owo_colors::OwoColorize::style(self, if *NO_COLOR { Style::new() } else { style })
    }
}

const COMMAND_STYLE: Style = Style::new().blue();
const CACHE_MISS_STYLE: Style = Style::new().bright_black();

/// Format the display's cwd as a string relative to the workspace root.
/// Returns an empty string if the cwd equals the workspace root.
fn format_cwd_relative(display: &ExecutionItemDisplay, workspace_path: &AbsolutePath) -> Str {
    let cwd_relative = if let Ok(Some(rel)) = display.cwd.strip_prefix(workspace_path) {
        Str::from(rel.as_str())
    } else {
        Str::default()
    };
    if cwd_relative.is_empty() { Str::default() } else { vite_str::format!("~/{cwd_relative}") }
}

/// Format the task label for labeled/grouped modes (e.g., `[pkg#task]`).
fn format_task_label(display: &ExecutionItemDisplay) -> Str {
    vite_str::format!(
        "{}",
        vite_str::format!("[{}]", display.task_display).style(Style::new().bright_black())
    )
}

/// Format the command string with cwd prefix for display (e.g., `~/packages/lib$ vitest run`).
fn format_command_display(display: &ExecutionItemDisplay, workspace_path: &AbsolutePath) -> Str {
    let cwd_str = format_cwd_relative(display, workspace_path);
    vite_str::format!("{cwd_str}$ {}", display.command)
}

/// Format the command line with optional inline cache status.
///
/// This is called during `start()` to show the user what command is being executed
/// and its cache status. The caller writes the returned string to the async writer.
fn format_command_with_cache_status(
    display: &ExecutionItemDisplay,
    workspace_path: &AbsolutePath,
    cache_status: &CacheStatus,
) -> Str {
    let command_str = format_command_display(display, workspace_path);
    format_cache_status_inline(cache_status).map_or_else(
        || vite_str::format!("{}\n", command_str.style(COMMAND_STYLE)),
        |inline_status| {
            let styled_status = inline_status.split_once(' ').map_or_else(
                || inline_status.style(Style::new().bright_black()).to_string(),
                |(symbol, text)| {
                    let (symbol_style, text_style) = match cache_status {
                        CacheStatus::Hit { .. } => {
                            (Style::new().green(), Style::new().bright_black())
                        }
                        CacheStatus::Miss(_) => (CACHE_MISS_STYLE, Style::new().bright_black()),
                        CacheStatus::Disabled(_) => {
                            (Style::new().black(), Style::new().bright_black())
                        }
                    };

                    vite_str::format!("{} {}", symbol.style(symbol_style), text.style(text_style))
                        .to_string()
                },
            );

            vite_str::format!("{} {styled_status}\n", command_str.style(COMMAND_STYLE))
        },
    )
}

/// Format an error message in red with an error icon.
fn format_error_message(message: &str) -> Str {
    vite_str::format!(
        "{} {}\n",
        "✗".style(Style::new().red().bold()),
        message.style(Style::new().red())
    )
}

/// Write the trailing output for a leaf execution: optional extra content (e.g., grouped
/// output block), error message, and a separating newline.
fn write_leaf_trailing_output(
    writer: &std::cell::RefCell<Box<dyn Write>>,
    error: Option<ExecutionError>,
    started: bool,
    extra: &[u8],
) {
    let mut buf = Vec::new();

    buf.extend_from_slice(extra);

    if let Some(error) = error {
        let message = vite_str::format!("{:#}", anyhow::Error::from(error));
        buf.extend_from_slice(format_error_message(&message).as_bytes());
    }

    if started {
        buf.push(b'\n');
    }

    if !buf.is_empty() {
        let mut writer = writer.borrow_mut();
        let _ = writer.write_all(&buf);
        let _ = writer.flush();
    }
}

/// Format the "cache hit, logs replayed" message for synthetic executions without display info.
fn format_cache_hit_message() -> Str {
    vite_str::format!("{}\n", "◉ cache hit, logs replayed".style(Style::new().green().dimmed()))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test fixtures (shared by child module tests)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
pub mod test_fixtures {
    use std::{collections::BTreeMap, sync::Arc};

    use vite_path::AbsolutePath;
    use vite_task_graph::display::TaskDisplay;
    use vite_task_plan::{
        ExecutionItem, ExecutionItemDisplay, ExecutionItemKind, InProcessExecution,
        LeafExecutionKind, SpawnCommand, SpawnExecution, TaskExecution,
    };

    /// Create a dummy `AbsolutePath` for test fixtures.
    pub fn test_path() -> Arc<AbsolutePath> {
        #[cfg(unix)]
        {
            Arc::from(AbsolutePath::new("/test").unwrap())
        }
        #[cfg(windows)]
        {
            Arc::from(AbsolutePath::new("C:\\test").unwrap())
        }
    }

    /// Create a dummy `TaskDisplay` for test fixtures.
    pub fn test_task_display(name: &str) -> TaskDisplay {
        TaskDisplay {
            package_name: "pkg".into(),
            task_name: name.into(),
            package_path: test_path(),
        }
    }

    /// Create a dummy `ExecutionItemDisplay` for test fixtures.
    pub fn test_display(name: &str) -> ExecutionItemDisplay {
        ExecutionItemDisplay {
            task_display: test_task_display(name),
            command: name.into(),
            and_item_index: None,
            cwd: test_path(),
        }
    }

    /// Create a `TaskExecution` with a single spawn leaf.
    pub fn spawn_task(name: &str) -> TaskExecution {
        TaskExecution {
            task_display: test_task_display(name),
            items: vec![ExecutionItem {
                execution_item_display: test_display(name),
                kind: ExecutionItemKind::Leaf(LeafExecutionKind::Spawn(SpawnExecution {
                    cache_metadata: None,
                    spawn_command: SpawnCommand {
                        program_path: test_path(),
                        args: Arc::from([]),
                        all_envs: Arc::new(BTreeMap::new()),
                        cwd: test_path(),
                    },
                })),
            }],
        }
    }

    /// Create a `TaskExecution` with a single in-process leaf (echo).
    pub fn in_process_task(name: &str) -> TaskExecution {
        TaskExecution {
            task_display: test_task_display(name),
            items: vec![ExecutionItem {
                execution_item_display: test_display(name),
                kind: ExecutionItemKind::Leaf(LeafExecutionKind::InProcess(
                    InProcessExecution::get_builtin_execution(
                        "echo",
                        ["hello"].iter(),
                        &test_path(),
                    )
                    .unwrap(),
                )),
            }],
        }
    }
}
