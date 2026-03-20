use std::sync::Arc;

use bincode::{Decode, Encode};
use serde::{Deserialize, Serialize};
use vite_path::RelativePathBuf;
use vite_str::{self, Str};
use vite_task_graph::config::ResolvedInputConfig;

use crate::envs::EnvFingerprints;

/// Key to identify an execution across sessions.
#[derive(Debug, Encode, Decode, Serialize)]
pub enum ExecutionCacheKey {
    /// This execution is from a script of a user-defined task.
    UserTask {
        /// The name of the user-defined task.
        task_name: Str,
        /// The index of the execution item in the task's command split by `&&`.
        /// This is to distinguish multiple execution items from the same task.
        and_item_index: usize,
        /// Extra args provided when invoking the user-defined task (`vp [task_name] [extra_args...]`).
        /// These args are appended to the last `and_item`. Non-last `and_items` don't get extra args.
        extra_args: Arc<[Str]>,
        /// The package path where the user-defined task is defined, relative to the workspace root.
        package_path: RelativePathBuf,
    },
    /// This execution is from a synthetic task directly invoked from `Session::plan_exec` API.
    ///
    /// The cache key is an opaque value provided by the caller.
    ExecAPI(Arc<[Str]>),
}

/// Cache information for a spawn execution.
///
/// It only contains information needed for hitting existing cache entries pre-execution.
/// It doesn't contain any post-execution information like file fingerprints
/// (which needs actual execution and is out of scope for planning).
#[derive(Debug, Serialize)]
pub struct CacheMetadata {
    /// Fingerprint for spawn execution that affects caching.
    pub spawn_fingerprint: SpawnFingerprint,

    /// Key to identify an execution across sessions.
    pub execution_cache_key: ExecutionCacheKey,

    /// Resolved input configuration for cache fingerprinting.
    /// Used at execution time to determine what files to track.
    pub input_config: ResolvedInputConfig,
}

/// Fingerprint for spawn execution that affects caching.
///
/// # Environment Variable Impact on Cache
///
/// The `envs_without_untracked` field is crucial for cache correctness:
/// - Only includes env vars explicitly declared in the task's `env` array
/// - Does NOT include untracked envs (PATH, CI, etc.)
/// - These env vars become part of the cache key
///
/// When a task runs:
/// 1. All envs (including untracked) are available to the process
/// 2. Only declared envs affect the cache key
/// 3. If a declared env changes value, cache will miss
/// 4. If an untracked env changes, cache will still hit
///
/// For built-in tasks (lint, build, etc):
/// - The resolver provides envs which become part of the fingerprint
/// - If resolver provides different envs between runs, cache breaks
/// - Each built-in task type must have unique task name to avoid cache collision
#[derive(Encode, Decode, Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
pub struct SpawnFingerprint {
    pub(crate) cwd: RelativePathBuf,
    pub(crate) program_fingerprint: ProgramFingerprint,
    pub(crate) args: Arc<[Str]>,
    pub(crate) env_fingerprints: EnvFingerprints,
}

impl SpawnFingerprint {
    /// Get the environment fingerprints.
    #[must_use]
    pub const fn env_fingerprints(&self) -> &EnvFingerprints {
        &self.env_fingerprints
    }

    /// Get the program fingerprint as a debug string.
    #[must_use]
    pub fn program_fingerprint_debug(&self) -> Str {
        vite_str::format!("{:?}", self.program_fingerprint)
    }

    /// Get the command args.
    #[must_use]
    pub const fn args(&self) -> &Arc<[Str]> {
        &self.args
    }

    /// Get the working directory.
    #[must_use]
    pub const fn cwd(&self) -> &RelativePathBuf {
        &self.cwd
    }
}

/// The program fingerprint used in `SpawnFingerprint`
#[derive(Encode, Decode, Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
pub(crate) enum ProgramFingerprint {
    /// If the program is outside the workspace, fingerprint by its name only (like `node`, `npm`, etc)
    OutsideWorkspace { program_name: Str },

    /// If the program is inside the workspace, fingerprint by its path relative to the workspace root
    InsideWorkspace { relative_program_path: RelativePathBuf },
}
