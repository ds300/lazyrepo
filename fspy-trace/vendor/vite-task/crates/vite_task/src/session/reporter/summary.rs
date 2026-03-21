//! Structured summary types for persisting and rendering execution results.
//!
//! The [`LastRunSummary`] is built after every graph execution and:
//! 1. Saved atomically to `cache_path/last-summary.json` for `vp run --last-details`.
//! 2. Rendered immediately — either as a compact one-liner or a full detailed summary.
//!
//! Both the live reporter and the `--last-details` display use the same rendering
//! functions, ensuring consistent output.

use std::{io::Write, num::NonZeroI32, time::Duration};

use owo_colors::Style;
use serde::{Deserialize, Serialize};
use vite_path::AbsolutePath;
use vite_str::Str;

use super::{CACHE_MISS_STYLE, COMMAND_STYLE, ColorizeExt};
use crate::session::{
    cache::{
        CacheMiss, FingerprintMismatch, InputChangeKind, SpawnFingerprintChange,
        detect_spawn_fingerprint_changes, format_input_change_str, format_spawn_change,
    },
    event::{
        CacheDisabledReason, CacheErrorKind, CacheNotUpdatedReason, CacheStatus, CacheUpdateStatus,
        ExecutionError,
    },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Structured types (Serialize + Deserialize for JSON persistence)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Saved summary of a task runner execution.
///
/// Persisted as `last-summary.json` in the cache directory.
#[derive(Serialize, Deserialize)]
pub struct LastRunSummary {
    pub tasks: Vec<TaskSummary>,
    pub exit_code: u8,
}

/// Summary for a single task execution.
///
/// All fields are structured data — no pre-formatted display strings.
/// Formatting (including color decisions) happens at render time.
#[derive(Serialize, Deserialize)]
pub struct TaskSummary {
    pub package_name: Str,
    pub task_name: Str,
    /// Raw command text (e.g., "vitest run").
    pub command: Str,
    /// Working directory relative to workspace root (e.g., "packages/lib").
    /// Empty string when the cwd is the workspace root.
    pub cwd: Str,
    /// Combined cache status and execution outcome.
    pub result: TaskResult,
}

/// The complete result of a task execution.
///
/// Encodes both the cache status and execution outcome in a single enum,
/// making invalid combinations unrepresentable.
#[derive(Serialize, Deserialize)]
pub enum TaskResult {
    /// Cache hit — output was replayed from cache. Always successful.
    CacheHit { saved_duration_ms: u64 },

    /// In-process execution (built-in command like echo). Always successful.
    InProcess,

    /// A process was spawned.
    Spawned {
        /// Why the process was spawned (cache miss or cache disabled).
        cache_status: SpawnedCacheStatus,
        outcome: SpawnOutcome,
    },
}

/// Cache status for tasks that required spawning a process.
///
/// Only two cache statuses lead to spawning:
/// - `Miss`: cache lookup found no match or a mismatch.
/// - `Disabled`: no cache configuration for this task.
///
/// `Hit` and `InProcessExecution` are handled by [`TaskResult::CacheHit`]
/// and [`TaskResult::InProcess`] respectively.
#[derive(Serialize, Deserialize)]
pub enum SpawnedCacheStatus {
    Miss(SavedCacheMissReason),
    /// No cache configuration for this task.
    Disabled,
}

/// Outcome of a spawned process.
#[derive(Serialize, Deserialize)]
pub enum SpawnOutcome {
    /// Process exited successfully (exit code 0).
    /// May have a post-execution infrastructure error (cache update or fingerprint failed).
    /// These only run after exit 0, so this field only exists on the success path.
    Success {
        infra_error: Option<SavedExecutionError>,
        /// First path that was both read and written, causing cache to be skipped.
        /// Only set when fspy detected a read-write overlap.
        input_modified_path: Option<Str>,
    },

    /// Process exited with non-zero status.
    /// [`NonZeroI32`] enforces that exit code 0 is unrepresentable here.
    /// No `infra_error` field: cache operations are skipped on non-zero exit.
    Failed { exit_code: NonZeroI32 },

    /// Could not start the process (e.g., command not found).
    SpawnError(SavedExecutionError),
}

/// Why a cache miss occurred.
#[derive(Serialize, Deserialize)]
pub enum SavedCacheMissReason {
    /// No previous cache entry for this task.
    NotFound,
    /// Spawn fingerprint changed (command, envs, cwd, etc.).
    SpawnFingerprintChanged(Vec<SpawnFingerprintChange>),
    /// Task configuration changed (`input_config` or `glob_base`).
    ConfigChanged,
    /// An input file or folder changed.
    InputChanged { kind: InputChangeKind, path: Str },
}

/// An execution error, serializable for persistence.
///
/// The `message` field contains the raw inner error text (from `anyhow::Error`).
/// The error prefix (e.g., "Cache update failed") is derived from the variant
/// at render time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SavedExecutionError {
    Cache { kind: SavedCacheErrorKind, message: Str },
    Spawn { message: Str },
    PostRunFingerprint { message: Str },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SavedCacheErrorKind {
    Lookup,
    Update,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Computed stats (derived from tasks, not persisted)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

struct SummaryStats {
    total: usize,
    cache_hits: usize,
    cache_misses: usize,
    cache_disabled: usize,
    failed: usize,
    total_saved: Duration,
    /// Display names of tasks that were not cached due to read-write overlap.
    input_modified_task_names: Vec<Str>,
}

impl SummaryStats {
    fn compute(tasks: &[TaskSummary]) -> Self {
        let mut stats = Self {
            total: tasks.len(),
            cache_hits: 0,
            cache_misses: 0,
            cache_disabled: 0,
            failed: 0,
            total_saved: Duration::ZERO,
            input_modified_task_names: Vec::new(),
        };

        for task in tasks {
            match &task.result {
                TaskResult::CacheHit { saved_duration_ms } => {
                    stats.cache_hits += 1;
                    stats.total_saved += Duration::from_millis(*saved_duration_ms);
                }
                TaskResult::InProcess => {
                    stats.cache_disabled += 1;
                }
                TaskResult::Spawned { cache_status, outcome } => {
                    match cache_status {
                        SpawnedCacheStatus::Miss(_) => stats.cache_misses += 1,
                        SpawnedCacheStatus::Disabled => stats.cache_disabled += 1,
                    }
                    match outcome {
                        SpawnOutcome::Success { infra_error: Some(_), .. }
                        | SpawnOutcome::Failed { .. }
                        | SpawnOutcome::SpawnError(_) => stats.failed += 1,
                        SpawnOutcome::Success { input_modified_path: Some(_), .. } => {
                            stats.input_modified_task_names.push(task.format_task_display());
                        }
                        SpawnOutcome::Success { .. } => {}
                    }
                }
            }
        }

        stats
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Conversion from live execution data
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

impl SavedExecutionError {
    /// Convert a live [`ExecutionError`] into a serializable error.
    pub fn from_execution_error(error: &ExecutionError) -> Self {
        match error {
            ExecutionError::Cache { kind, source } => Self::Cache {
                kind: match kind {
                    CacheErrorKind::Lookup => SavedCacheErrorKind::Lookup,
                    CacheErrorKind::Update => SavedCacheErrorKind::Update,
                },
                message: vite_str::format!("{source:#}"),
            },
            ExecutionError::Spawn(source) => {
                Self::Spawn { message: vite_str::format!("{source:#}") }
            }
            ExecutionError::PostRunFingerprint(source) => {
                Self::PostRunFingerprint { message: vite_str::format!("{source:#}") }
            }
        }
    }

    /// Format the full error message for display.
    fn display_message(&self) -> Str {
        match self {
            Self::Cache { kind, message } => {
                let kind_str = match kind {
                    SavedCacheErrorKind::Lookup => "lookup",
                    SavedCacheErrorKind::Update => "update",
                };
                vite_str::format!("Cache {kind_str} failed: {message}")
            }
            Self::Spawn { message } => {
                vite_str::format!("Failed to spawn process: {message}")
            }
            Self::PostRunFingerprint { message } => {
                vite_str::format!("Failed to create post-run fingerprint: {message}")
            }
        }
    }
}

impl SavedCacheMissReason {
    fn from_cache_miss(cache_miss: &CacheMiss) -> Self {
        match cache_miss {
            CacheMiss::NotFound => Self::NotFound,
            CacheMiss::FingerprintMismatch(mismatch) => match mismatch {
                FingerprintMismatch::SpawnFingerprint { old, new } => {
                    Self::SpawnFingerprintChanged(detect_spawn_fingerprint_changes(old, new))
                }
                FingerprintMismatch::InputConfig => Self::ConfigChanged,
                FingerprintMismatch::InputChanged { kind, path } => {
                    Self::InputChanged { kind: *kind, path: Str::from(path.as_str()) }
                }
            },
        }
    }
}

impl TaskResult {
    /// Build a [`TaskResult`] from live execution data.
    ///
    /// `cache_status`: the cache status determined at `start()` time.
    /// `exit_status`: the process exit status, or `None` for cache hit / in-process.
    /// `saved_error`: an optional pre-converted execution error.
    /// `cache_update_status`: the post-execution cache update result.
    pub fn from_execution(
        cache_status: &CacheStatus,
        exit_status: Option<std::process::ExitStatus>,
        saved_error: Option<&SavedExecutionError>,
        cache_update_status: &CacheUpdateStatus,
    ) -> Self {
        let input_modified_path = match cache_update_status {
            CacheUpdateStatus::NotUpdated(CacheNotUpdatedReason::InputModified { path }) => {
                Some(Str::from(path.as_str()))
            }
            _ => None,
        };

        match cache_status {
            CacheStatus::Hit { replayed_duration } => {
                Self::CacheHit { saved_duration_ms: duration_to_ms(*replayed_duration) }
            }
            CacheStatus::Disabled(CacheDisabledReason::InProcessExecution) => Self::InProcess,
            CacheStatus::Disabled(CacheDisabledReason::NoCacheMetadata) => Self::Spawned {
                cache_status: SpawnedCacheStatus::Disabled,
                outcome: spawn_outcome_from_execution(
                    exit_status,
                    saved_error,
                    input_modified_path,
                ),
            },
            CacheStatus::Miss(cache_miss) => Self::Spawned {
                cache_status: SpawnedCacheStatus::Miss(SavedCacheMissReason::from_cache_miss(
                    cache_miss,
                )),
                outcome: spawn_outcome_from_execution(
                    exit_status,
                    saved_error,
                    input_modified_path,
                ),
            },
        }
    }
}

/// Build a [`SpawnOutcome`] from process exit status and optional pre-converted error.
fn spawn_outcome_from_execution(
    exit_status: Option<std::process::ExitStatus>,
    saved_error: Option<&SavedExecutionError>,
    input_modified_path: Option<Str>,
) -> SpawnOutcome {
    match (exit_status, saved_error) {
        // Spawn error — process never ran
        (None, Some(err)) => SpawnOutcome::SpawnError(err.clone()),
        // Process exited successfully, possible infra error
        (Some(status), _) if status.success() => {
            SpawnOutcome::Success { infra_error: saved_error.cloned(), input_modified_path }
        }
        // Process exited with non-zero code
        (Some(status), _) => {
            let code = crate::session::event::exit_status_to_code(status);
            SpawnOutcome::Failed {
                // exit_status_to_code returns 1..=255 for failed processes (see its
                // implementation: always positive, non-zero for non-success status).
                // NonZeroI32::new returns None only for 0, which cannot happen here.
                exit_code: NonZeroI32::new(code).unwrap_or(NonZeroI32::MIN),
            }
        }
        // No exit status, no error — this is the cache hit / in-process path,
        // handled by TaskResult::CacheHit / InProcess before reaching here.
        // If we somehow get here, treat as success.
        (None, None) => SpawnOutcome::Success { infra_error: None, input_modified_path: None },
    }
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "value is clamped to u64::MAX before casting, so no data loss"
)]
fn duration_to_ms(d: Duration) -> u64 {
    d.as_millis().min(u128::from(u64::MAX)) as u64
}

fn format_summary_duration(d: Duration) -> Str {
    let formatted = vite_str::format!("{d:.2?}");

    for (suffix, unit) in
        [(".00ms", "ms"), (".00s", "s"), (".00us", "us"), (".00µs", "µs"), (".00ns", "ns")]
    {
        if let Some(prefix) = formatted.as_str().strip_suffix(suffix) {
            return vite_str::format!("{prefix}{unit}");
        }
    }

    formatted
}

impl LastRunSummary {
    // ── Persistence ──────────────────────────────────────────────────────

    /// Write the summary as JSON atomically (write to `.tmp`, then rename).
    ///
    /// Errors are returned to the caller (the reporter logs them without propagating).
    #[expect(
        clippy::disallowed_types,
        reason = "PathBuf is needed to construct a temporary path by appending .tmp suffix; \
                  AbsolutePathBuf cannot be constructed without validation"
    )]
    pub fn write_atomic(&self, path: &AbsolutePath) -> std::io::Result<()> {
        let json = serde_json::to_vec(self).map_err(std::io::Error::other)?;

        let mut tmp_os = path.as_path().as_os_str().to_owned();
        tmp_os.push(".tmp");
        let tmp_path = std::path::PathBuf::from(tmp_os);
        std::fs::write(&tmp_path, &json)?;
        std::fs::rename(&tmp_path, path)?;
        Ok(())
    }

    /// Read a summary from a JSON file.
    ///
    /// Returns `Ok(None)` if the file does not exist.
    /// Returns `Err` on parse or IO errors (caller provides version mismatch message).
    pub fn read_from_path(path: &AbsolutePath) -> Result<Option<Self>, ReadSummaryError> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(ReadSummaryError::Io(err)),
        };
        let summary =
            serde_json::from_slice(&bytes).map_err(|_| ReadSummaryError::IncompatibleVersion)?;
        Ok(Some(summary))
    }
}

/// Error type for [`LastRunSummary::read_from_path`].
pub enum ReadSummaryError {
    Io(std::io::Error),
    /// The JSON could not be parsed — likely saved by a different version.
    IncompatibleVersion,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Display helpers for TaskResult
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

impl TaskSummary {
    /// Format the task display name (e.g., "package#task" or "task").
    fn format_task_display(&self) -> Str {
        if self.package_name.is_empty() {
            self.task_name.clone()
        } else {
            vite_str::format!("{}#{}", self.package_name, self.task_name)
        }
    }

    /// Format the command with cwd prefix (e.g., "~/packages/lib$ vitest run").
    fn format_command_display(&self) -> Str {
        if self.cwd.is_empty() {
            vite_str::format!("$ {}", self.command)
        } else {
            vite_str::format!("~/{cwd}$ {cmd}", cwd = self.cwd, cmd = self.command)
        }
    }
}

impl TaskResult {
    /// Whether this task succeeded (used for exit icon rendering).
    const fn is_success(&self) -> bool {
        match self {
            Self::CacheHit { .. } | Self::InProcess => true,
            Self::Spawned { outcome, .. } => matches!(outcome, SpawnOutcome::Success { .. }),
        }
    }

    /// Format the cache status detail line for the full summary.
    ///
    /// Examples:
    /// - "→ Cache hit - output replayed - 102.96ms saved"
    /// - "→ Cache miss: no previous cache entry found"
    /// - "→ Cache disabled in task configuration"
    fn format_cache_detail(&self) -> Str {
        // Check for input modification first — it overrides the cache miss reason
        if let Self::Spawned {
            outcome: SpawnOutcome::Success { input_modified_path: Some(path), .. },
            ..
        } = self
        {
            return vite_str::format!("→ Not cached: read and wrote '{path}'");
        }

        match self {
            Self::CacheHit { saved_duration_ms } => {
                let d = Duration::from_millis(*saved_duration_ms);
                let formatted_duration = format_summary_duration(d);
                vite_str::format!("→ Cache hit - output replayed - {formatted_duration} saved")
            }
            Self::InProcess => Str::from("→ Cache disabled for built-in command"),
            Self::Spawned { cache_status, .. } => match cache_status {
                SpawnedCacheStatus::Disabled => Str::from("→ Cache disabled in task configuration"),
                SpawnedCacheStatus::Miss(reason) => match reason {
                    SavedCacheMissReason::NotFound => {
                        Str::from("→ Cache miss: no previous cache entry found")
                    }
                    SavedCacheMissReason::SpawnFingerprintChanged(changes) => {
                        let formatted: Vec<Str> = changes.iter().map(format_spawn_change).collect();
                        if formatted.is_empty() {
                            Str::from("→ Cache miss: configuration changed")
                        } else {
                            let joined =
                                formatted.iter().map(Str::as_str).collect::<Vec<_>>().join("; ");
                            vite_str::format!("→ Cache miss: {joined}")
                        }
                    }
                    SavedCacheMissReason::ConfigChanged => {
                        Str::from("→ Cache miss: input configuration changed")
                    }
                    SavedCacheMissReason::InputChanged { kind, path } => {
                        let desc = format_input_change_str(*kind, path.as_str());
                        vite_str::format!("→ Cache miss: {desc}")
                    }
                },
            },
        }
    }

    /// The [`Style`] for the cache detail line.
    const fn cache_detail_style(&self) -> Style {
        match self {
            Self::CacheHit { .. } => Style::new().green(),
            Self::InProcess => Style::new().bright_black(),
            Self::Spawned { cache_status: SpawnedCacheStatus::Disabled, .. } => {
                Style::new().bright_black()
            }
            Self::Spawned { cache_status: SpawnedCacheStatus::Miss(_), .. } => CACHE_MISS_STYLE,
        }
    }

    /// Optional error associated with this result.
    pub const fn error(&self) -> Option<&SavedExecutionError> {
        match self {
            Self::CacheHit { .. } | Self::InProcess => None,
            Self::Spawned { outcome, .. } => match outcome {
                SpawnOutcome::Success { infra_error, .. } => infra_error.as_ref(),
                SpawnOutcome::Failed { .. } => None,
                SpawnOutcome::SpawnError(err) => Some(err),
            },
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Full summary rendering (--verbose and --last-details)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Render the full detailed execution summary.
///
/// Used by both `--verbose` (live) and `--last-details` (from file).
#[expect(
    clippy::too_many_lines,
    reason = "summary formatting is inherently verbose with many write calls"
)]
pub fn format_full_summary(summary: &LastRunSummary) -> Vec<u8> {
    let mut buf = Vec::new();

    let stats = SummaryStats::compute(&summary.tasks);

    // Header
    let _ = writeln!(buf);
    let _ = writeln!(
        buf,
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".style(Style::new().bright_black())
    );
    let _ = writeln!(
        buf,
        "{}",
        "    Vite+ Task Runner • Execution Summary".style(Style::new().bold().bright_white())
    );
    let _ = writeln!(
        buf,
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".style(Style::new().bright_black())
    );
    let _ = writeln!(buf);

    // Statistics line
    let cache_disabled_str = if stats.cache_disabled > 0 {
        let n = stats.cache_disabled;
        Str::from(
            vite_str::format!("• {n} cache disabled")
                .style(Style::new().bright_black())
                .to_string(),
        )
    } else {
        Str::default()
    };

    let failed_str = if stats.failed > 0 {
        let n = stats.failed;
        Str::from(vite_str::format!("• {n} failed").style(Style::new().red()).to_string())
    } else {
        Str::default()
    };

    let total = stats.total;
    let cache_hits = stats.cache_hits;
    let cache_misses = stats.cache_misses;
    let _ = write!(
        buf,
        "{}  {} {} {}",
        "Statistics:".style(Style::new().bold()),
        vite_str::format!(" {total} tasks").style(Style::new().bright_white()),
        vite_str::format!("• {cache_hits} cache hits").style(Style::new().green()),
        vite_str::format!("• {cache_misses} cache misses").style(CACHE_MISS_STYLE),
    );
    if !cache_disabled_str.is_empty() {
        let _ = write!(buf, " {cache_disabled_str}");
    }
    if !failed_str.is_empty() {
        let _ = write!(buf, " {failed_str}");
    }
    let _ = writeln!(buf);

    // Performance line
    #[expect(
        clippy::cast_possible_truncation,
        reason = "percentage is always 0..=100, fits in u32"
    )]
    #[expect(clippy::cast_sign_loss, reason = "percentage is always non-negative")]
    #[expect(
        clippy::cast_precision_loss,
        reason = "acceptable precision loss for display percentage"
    )]
    let cache_rate = if total > 0 { (cache_hits as f64 / total as f64 * 100.0) as u32 } else { 0 };

    let _ = write!(
        buf,
        "{}  {} cache hit rate",
        "Performance:".style(Style::new().bold()),
        format_args!("{cache_rate}%").style(if cache_rate >= 75 {
            Style::new().green().bold()
        } else if cache_rate >= 50 {
            CACHE_MISS_STYLE
        } else {
            Style::new().red()
        })
    );

    if stats.total_saved > Duration::ZERO {
        let formatted_total_saved = format_summary_duration(stats.total_saved);
        let _ = write!(
            buf,
            ", {} saved in total",
            formatted_total_saved.style(Style::new().green().bold())
        );
    }
    let _ = writeln!(buf);
    let _ = writeln!(buf);

    // Task Details
    let _ = writeln!(buf, "{}", "Task Details:".style(Style::new().bold()));
    let _ = writeln!(
        buf,
        "{}",
        "────────────────────────────────────────────────".style(Style::new().bright_black())
    );

    for (idx, task) in summary.tasks.iter().enumerate() {
        // Task index and name
        let _ = write!(
            buf,
            "  {} {}",
            vite_str::format!("[{}]", idx + 1).style(Style::new().bright_black()),
            task.format_task_display().to_string().style(Style::new().bright_white().bold())
        );

        // Command with cwd prefix
        let _ = write!(buf, ": {}", task.format_command_display().style(COMMAND_STYLE));

        // Exit icon
        if task.result.is_success() {
            let _ = write!(buf, " {}", "✓".style(Style::new().green().bold()));
        } else if let TaskResult::Spawned { outcome: SpawnOutcome::Failed { exit_code }, .. } =
            &task.result
        {
            let code = exit_code.get();
            let _ = write!(
                buf,
                " {} {}",
                "✗".style(Style::new().red().bold()),
                vite_str::format!("(exit code: {code})").style(Style::new().red())
            );
        }
        let _ = writeln!(buf);

        // Cache status detail
        let cache_detail = task.result.format_cache_detail();
        let _ = writeln!(buf, "      {}", cache_detail.style(task.result.cache_detail_style()));

        // Error message if present
        if let Some(err) = task.result.error() {
            let msg = err.display_message();
            let _ = writeln!(
                buf,
                "      {} {}",
                "✗ Error:".style(Style::new().red().bold()),
                msg.style(Style::new().red())
            );
        }

        // Separator between tasks (except last)
        if idx < summary.tasks.len() - 1 {
            let _ = writeln!(
                buf,
                "  {}",
                "·······················································"
                    .style(Style::new().bright_black())
            );
        }
    }

    let _ = writeln!(
        buf,
        "{}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".style(Style::new().bright_black())
    );

    buf
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Compact summary rendering (default mode)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Render a compact summary (one-liner or empty).
///
/// Rules:
/// - Single task + not cache hit → empty (no summary at all)
/// - Single task + cache hit → thin line + "vp run: cache hit, {duration} saved."
/// - Multi-task → thin line + "vp run: {hits}/{total} cache hit ({rate}%), {duration} saved."
///   with optional failure count and `--verbose` hint.
pub fn format_compact_summary(summary: &LastRunSummary, program_name: &str) -> Vec<u8> {
    let stats = SummaryStats::compute(&summary.tasks);

    let is_single_task = summary.tasks.len() == 1;

    // Single task + not cache hit + no input modification → no summary
    if is_single_task && stats.cache_hits == 0 && stats.input_modified_task_names.is_empty() {
        return Vec::new();
    }

    let mut buf = Vec::new();

    // Thin line separator
    let _ = writeln!(buf, "{}", "---".style(Style::new().bright_black()));

    let run_label = vite_str::format!("{program_name} run:");
    let mut show_last_details_hint = true;
    if is_single_task && stats.cache_hits > 0 {
        // Single task cache hit — no need for --last-details hint
        let formatted_total_saved = format_summary_duration(stats.total_saved);
        let _ = write!(
            buf,
            "{} cache hit, {} saved.",
            run_label.as_str().style(Style::new().blue().bold()),
            formatted_total_saved.style(Style::new().green().bold()),
        );
        show_last_details_hint = false;
    } else if !is_single_task {
        // Multi-task
        let total = stats.total;
        let hits = stats.cache_hits;

        #[expect(
            clippy::cast_possible_truncation,
            reason = "percentage is always 0..=100, fits in u32"
        )]
        #[expect(clippy::cast_sign_loss, reason = "percentage is always non-negative")]
        #[expect(
            clippy::cast_precision_loss,
            reason = "acceptable precision loss for display percentage"
        )]
        let rate = if total > 0 { (hits as f64 / total as f64 * 100.0) as u32 } else { 0 };

        let _ = write!(
            buf,
            "{} {hits}/{total} cache hit ({rate}%)",
            run_label.as_str().style(Style::new().blue().bold()),
        );

        if stats.total_saved > Duration::ZERO {
            let formatted_total_saved = format_summary_duration(stats.total_saved);
            let _ = write!(
                buf,
                ", {} saved",
                formatted_total_saved.style(Style::new().green().bold()),
            );
        }

        if stats.failed > 0 {
            let n = stats.failed;
            let _ = write!(buf, ", {} failed", n.style(Style::new().red()));
        }

        let _ = write!(buf, ".");
    } else {
        // Single task, no cache hit — only shown when input_modified is non-empty
        let _ = write!(buf, "{}", run_label.as_str().style(Style::new().blue().bold()));
    }

    // Inline input-modified notice before the --last-details hint
    if !stats.input_modified_task_names.is_empty() {
        format_input_modified_notice(&mut buf, &stats.input_modified_task_names);
    }

    if show_last_details_hint {
        let last_details_cmd = vite_str::format!("`{program_name} run --last-details`");
        let _ = write!(buf, " {}", "(Run ".style(Style::new().bright_black()));
        let _ = write!(buf, "{}", last_details_cmd.as_str().style(COMMAND_STYLE));
        let _ = write!(buf, "{}", " for full details)".style(Style::new().bright_black()));
    }
    let _ = writeln!(buf);

    buf
}

/// Write the "not cached because it modified its input" notice inline.
fn format_input_modified_notice(buf: &mut Vec<u8>, task_names: &[Str]) {
    let _ = write!(buf, " ");

    let first = &task_names[0];
    let _ = write!(buf, "{}", first.as_str().style(Style::new().bold()));
    let remaining = task_names.len() - 1;
    if remaining > 0 {
        let _ = write!(buf, " (and {remaining} more)");
    }

    if task_names.len() == 1 {
        let _ = write!(buf, " not cached because it modified its input.");
    } else {
        let _ = write!(buf, " not cached because they modified their inputs.");
    }
}
