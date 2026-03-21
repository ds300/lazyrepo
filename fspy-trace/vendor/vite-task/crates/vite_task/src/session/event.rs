use std::{process::ExitStatus, time::Duration};

use vite_path::RelativePathBuf;

use super::cache::CacheMiss;

/// The cache operation that failed.
#[derive(Debug)]
pub enum CacheErrorKind {
    /// Cache lookup (`try_hit`) failed.
    Lookup,
    /// Writing the cache entry failed after successful execution.
    Update,
}

impl std::fmt::Display for CacheErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Lookup => f.write_str("lookup"),
            Self::Update => f.write_str("update"),
        }
    }
}

/// Error that occurred during a leaf execution.
///
/// Reported through [`super::reporter::LeafExecutionReporter::finish()`] and
/// displayed by the reporter.
#[derive(Debug, thiserror::Error)]
pub enum ExecutionError {
    /// A cache operation failed.
    #[error("Cache {kind} failed")]
    Cache {
        kind: CacheErrorKind,
        #[source]
        source: anyhow::Error,
    },

    /// The OS failed to spawn the child process (e.g., command not found).
    #[error("Failed to spawn process")]
    Spawn(#[source] anyhow::Error),

    /// Creating the post-run fingerprint failed after successful execution.
    #[error("Failed to create post-run fingerprint")]
    PostRunFingerprint(#[source] anyhow::Error),
}

#[derive(Debug, Clone)]
pub enum CacheDisabledReason {
    InProcessExecution,
    NoCacheMetadata,
}

#[derive(Debug)]
pub enum CacheNotUpdatedReason {
    /// Cache was hit - task was replayed from cache, no update needed
    CacheHit,
    /// Caching was disabled for this task
    CacheDisabled,
    /// Execution exited with non-zero status
    NonZeroExitStatus,
    /// Task modified files it read during execution (read-write overlap detected by fspy).
    /// Caching such tasks is unsound because the prerun input hashes become stale.
    InputModified {
        /// First path that was both read and written during execution.
        path: RelativePathBuf,
    },
}

#[derive(Debug)]
pub enum CacheUpdateStatus {
    /// Cache was successfully updated with new fingerprint and outputs
    Updated,
    /// Cache was not updated (with reason).
    /// The reason is part of the `LeafExecutionReporter` trait contract — reporters
    /// can use it for detailed logging, even if current implementations don't.
    NotUpdated(CacheNotUpdatedReason),
}

#[derive(Debug, Clone)]
#[expect(
    clippy::large_enum_variant,
    reason = "CacheMiss variant is intentionally large and infrequently cloned"
)]
pub enum CacheStatus {
    Disabled(CacheDisabledReason),
    Miss(CacheMiss),
    Hit { replayed_duration: Duration },
}

/// Convert `ExitStatus` to an i32 exit code.
/// On Unix, if terminated by signal, returns 128 + `signal_number`.
pub fn exit_status_to_code(status: ExitStatus) -> i32 {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.code().unwrap_or_else(|| {
            // Process was terminated by signal, use Unix convention: 128 + signal
            status.signal().map_or(1, |sig| 128 + sig)
        })
    }
    #[cfg(not(unix))]
    {
        // Windows always has an exit code
        status.code().unwrap_or(1)
    }
}
