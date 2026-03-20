//! Execution cache for storing and retrieving cached command results.

pub mod display;

use std::{collections::BTreeMap, fmt::Display, fs::File, io::Write, sync::Arc, time::Duration};

use bincode::{Decode, Encode, decode_from_slice, encode_to_vec};
// Re-export display functions for convenience
pub use display::format_cache_status_inline;
pub use display::{
    SpawnFingerprintChange, detect_spawn_fingerprint_changes, format_input_change_str,
    format_spawn_change,
};
use rusqlite::{Connection, OptionalExtension as _, config::DbConfig};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use vite_path::{AbsolutePath, RelativePathBuf};
use vite_task_graph::config::ResolvedInputConfig;
use vite_task_plan::cache_metadata::{CacheMetadata, ExecutionCacheKey, SpawnFingerprint};

use super::execute::{fingerprint::PostRunFingerprint, spawn::StdOutput};

/// Cache lookup key identifying a task's execution configuration.
///
/// # Key vs value design
///
/// Put a field in the **key** if each distinct value should have its own
/// cache entry (e.g., different env values → different entries, so
/// reverting an env change can still hit the old entry).
///
/// Put a field in the **value** ([`CacheEntryValue`]) if changes should
/// overwrite the existing entry (e.g., input file hashes — there's no
/// reason to keep the old hash around, and storing them in the value
/// lets us report exactly *which file* changed).
#[derive(Debug, Encode, Decode, Serialize, PartialEq, Eq, Clone)]
pub struct CacheEntryKey {
    /// The spawn fingerprint (command, args, cwd, envs)
    pub spawn_fingerprint: SpawnFingerprint,
    /// Resolved input configuration that affects cache behavior.
    /// Glob patterns are workspace-root-relative.
    pub input_config: ResolvedInputConfig,
}

impl CacheEntryKey {
    fn from_metadata(cache_metadata: &CacheMetadata) -> Self {
        Self {
            spawn_fingerprint: cache_metadata.spawn_fingerprint.clone(),
            input_config: cache_metadata.input_config.clone(),
        }
    }
}

/// Cached execution result for a task.
///
/// Contains the post-run fingerprint (from fspy), captured outputs,
/// execution duration, and explicit input file hashes.
#[derive(Debug, Encode, Decode, Serialize)]
pub struct CacheEntryValue {
    pub post_run_fingerprint: PostRunFingerprint,
    pub std_outputs: Arc<[StdOutput]>,
    pub duration: Duration,
    /// Hashes of explicit input files computed from positive globs.
    /// Files matching negative globs are already filtered out.
    /// Path is relative to workspace root, value is `xxHash3_64` of file content.
    /// Stored in the value (not the key) so changes can be detected and reported.
    pub globbed_inputs: BTreeMap<RelativePathBuf, u64>,
}

#[derive(Debug)]
pub struct ExecutionCache {
    conn: Mutex<Connection>,
}

const BINCODE_CONFIG: bincode::config::Configuration = bincode::config::standard();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[expect(
    clippy::large_enum_variant,
    reason = "FingerprintMismatch contains SpawnFingerprint which is intentionally large; boxing would add unnecessary indirection for a short-lived enum"
)]
pub enum CacheMiss {
    NotFound,
    FingerprintMismatch(FingerprintMismatch),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum InputChangeKind {
    /// File content changed but path is the same
    ContentModified,
    /// New file or folder added
    Added,
    /// Existing file or folder removed
    Removed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FingerprintMismatch {
    /// Found a previous cache entry key for the same task, but the spawn fingerprint differs.
    /// This happens when the command itself or an env changes.
    SpawnFingerprint {
        /// The fingerprint from the cached entry
        old: SpawnFingerprint,
        /// The fingerprint of the current execution
        new: SpawnFingerprint,
    },
    /// Found a previous cache entry key for the same task, but `input_config` differs.
    InputConfig,

    InputChanged {
        kind: InputChangeKind,
        path: RelativePathBuf,
    },
}

impl Display for FingerprintMismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SpawnFingerprint { old, new } => {
                write!(f, "Spawn fingerprint changed: old={old:?}, new={new:?}")
            }
            Self::InputConfig => {
                write!(f, "input configuration changed")
            }
            Self::InputChanged { kind, path } => {
                write!(f, "{}", display::format_input_change_str(*kind, path.as_str()))
            }
        }
    }
}

/// Split a relative path into `(parent_dir, filename)`.
/// Returns `None` for the parent if the path has no `/` separator.
pub fn split_path(path: &str) -> (Option<&str>, &str) {
    match path.rsplit_once('/') {
        Some((parent, filename)) => (Some(parent), filename),
        None => (None, path),
    }
}

impl ExecutionCache {
    #[tracing::instrument(level = "debug", skip_all)]
    pub fn load_from_path(path: &AbsolutePath) -> anyhow::Result<Self> {
        tracing::info!("Creating task cache directory at {:?}", path);
        std::fs::create_dir_all(path)?;

        // Use file lock to prevent race conditions when multiple processes initialize the database
        let lock_path = path.join("db_open.lock");
        let lock_file = File::create(lock_path.as_path())?;
        #[expect(
            clippy::incompatible_msrv,
            reason = "File::lock is stable since 1.84.0, our MSRV 1.88.0 is higher; clippy false positive"
        )]
        lock_file.lock()?;

        let db_path = path.join("cache.db");
        let conn = Connection::open(db_path.as_path())?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        loop {
            let user_version: u32 = conn.query_one("PRAGMA user_version", (), |row| row.get(0))?;
            match user_version {
                0 => {
                    // fresh new db
                    conn.execute(
                        "CREATE TABLE cache_entries (key BLOB PRIMARY KEY, value BLOB);",
                        (),
                    )?;
                    conn.execute(
                        "CREATE TABLE task_fingerprints (key BLOB PRIMARY KEY, value BLOB);",
                        (),
                    )?;
                    conn.execute("PRAGMA user_version = 10", ())?;
                }
                1..=9 => {
                    // old internal db version. reset
                    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_RESET_DATABASE, true)?;
                    conn.execute("VACUUM", ())?;
                    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_RESET_DATABASE, false)?;
                }
                10 => break, // current version
                11.. => {
                    return Err(anyhow::anyhow!("Unrecognized database version: {user_version}"));
                }
            }
        }
        // Lock is released when lock_file is dropped
        Ok(Self { conn: Mutex::new(conn) })
    }

    #[tracing::instrument]
    pub async fn save(self) -> anyhow::Result<()> {
        // do some cleanup in the future
        Ok(())
    }

    /// Try to hit cache by looking up the cache entry key and validating inputs.
    /// Returns `Ok(Ok(cache_value))` on cache hit, `Ok(Err(cache_miss))` on miss.
    #[tracing::instrument(level = "debug", skip_all)]
    pub async fn try_hit(
        &self,
        cache_metadata: &CacheMetadata,
        globbed_inputs: &BTreeMap<RelativePathBuf, u64>,
        workspace_root: &AbsolutePath,
    ) -> anyhow::Result<Result<CacheEntryValue, CacheMiss>> {
        let spawn_fingerprint = &cache_metadata.spawn_fingerprint;
        let execution_cache_key = &cache_metadata.execution_cache_key;

        let cache_key = CacheEntryKey::from_metadata(cache_metadata);

        // Try to find the cache entry by key (spawn fingerprint + input config)
        if let Some(cache_value) = self.get_by_cache_key(&cache_key).await? {
            // Validate explicit globbed inputs against the stored values
            if let Some(mismatch) =
                detect_globbed_input_change(&cache_value.globbed_inputs, globbed_inputs)
            {
                return Ok(Err(CacheMiss::FingerprintMismatch(mismatch)));
            }

            // Validate post-run fingerprint (inferred inputs from fspy)
            if let Some((kind, path)) = cache_value.post_run_fingerprint.validate(workspace_root)? {
                return Ok(Err(CacheMiss::FingerprintMismatch(
                    FingerprintMismatch::InputChanged { kind, path },
                )));
            }
            // Associate the execution key to the cache entry key if not already,
            // so that next time we can find it and report what changed
            self.upsert_task_fingerprint(execution_cache_key, &cache_key).await?;
            return Ok(Ok(cache_value));
        }

        // No cache found with the current cache entry key,
        // check if execution key maps to a different cache entry key
        if let Some(old_cache_key) =
            self.get_cache_key_by_execution_key(execution_cache_key).await?
        {
            // Destructure to ensure we handle all fields when new ones are added
            let CacheEntryKey { spawn_fingerprint: old_spawn_fingerprint, input_config: _ } =
                old_cache_key;
            let mismatch = if old_spawn_fingerprint == *spawn_fingerprint {
                // spawn fingerprint is the same but input_config or glob_base changed
                FingerprintMismatch::InputConfig
            } else {
                FingerprintMismatch::SpawnFingerprint {
                    old: old_spawn_fingerprint,
                    new: spawn_fingerprint.clone(),
                }
            };
            return Ok(Err(CacheMiss::FingerprintMismatch(mismatch)));
        }

        Ok(Err(CacheMiss::NotFound))
    }

    /// Update cache after successful execution.
    #[tracing::instrument(level = "debug", skip_all)]
    pub async fn update(
        &self,
        cache_metadata: &CacheMetadata,
        cache_value: CacheEntryValue,
    ) -> anyhow::Result<()> {
        let execution_cache_key = &cache_metadata.execution_cache_key;

        let cache_key = CacheEntryKey::from_metadata(cache_metadata);

        self.upsert_cache_entry(&cache_key, &cache_value).await?;
        self.upsert_task_fingerprint(execution_cache_key, &cache_key).await?;
        Ok(())
    }
}

/// Compare stored and current globbed inputs, returning the first changed path.
/// Both maps are `BTreeMap` so we iterate them in sorted lockstep.
fn detect_globbed_input_change(
    stored: &BTreeMap<RelativePathBuf, u64>,
    current: &BTreeMap<RelativePathBuf, u64>,
) -> Option<FingerprintMismatch> {
    let mut stored_iter = stored.iter();
    let mut current_iter = current.iter();
    let mut s = stored_iter.next();
    let mut c = current_iter.next();

    loop {
        match (s, c) {
            (None, None) => return None,
            (Some((sp, _)), None) => {
                return Some(FingerprintMismatch::InputChanged {
                    kind: InputChangeKind::Removed,
                    path: sp.clone(),
                });
            }
            (None, Some((cp, _))) => {
                return Some(FingerprintMismatch::InputChanged {
                    kind: InputChangeKind::Added,
                    path: cp.clone(),
                });
            }
            (Some((sp, sh)), Some((cp, ch))) => match sp.cmp(cp) {
                std::cmp::Ordering::Equal => {
                    if sh != ch {
                        return Some(FingerprintMismatch::InputChanged {
                            kind: InputChangeKind::ContentModified,
                            path: sp.clone(),
                        });
                    }
                    s = stored_iter.next();
                    c = current_iter.next();
                }
                std::cmp::Ordering::Less => {
                    return Some(FingerprintMismatch::InputChanged {
                        kind: InputChangeKind::Removed,
                        path: sp.clone(),
                    });
                }
                std::cmp::Ordering::Greater => {
                    return Some(FingerprintMismatch::InputChanged {
                        kind: InputChangeKind::Added,
                        path: cp.clone(),
                    });
                }
            },
        }
    }
}

// Basic database operations
impl ExecutionCache {
    #[expect(
        clippy::significant_drop_tightening,
        reason = "lock guard cannot be dropped earlier because prepared statement borrows connection"
    )]
    async fn get_key_by_value<K: Encode, V: Decode<()>>(
        &self,
        table: &str,
        key: &K,
    ) -> anyhow::Result<Option<V>> {
        let key_blob = encode_to_vec(key, BINCODE_CONFIG)?;
        let value_blob = {
            let conn = self.conn.lock().await;
            #[expect(
                clippy::disallowed_macros,
                reason = "SQL query string for rusqlite requires String"
            )]
            let mut select_stmt =
                conn.prepare_cached(&format!("SELECT value FROM {table} WHERE key=?"))?;
            let value_blob: Option<Vec<u8>> =
                select_stmt.query_row::<Vec<u8>, _, _>([key_blob], |row| row.get(0)).optional()?;
            value_blob
        };
        let Some(value_blob) = value_blob else {
            return Ok(None);
        };
        let (value, _) = decode_from_slice::<V, _>(&value_blob, BINCODE_CONFIG)?;
        Ok(Some(value))
    }

    async fn get_by_cache_key(
        &self,
        cache_key: &CacheEntryKey,
    ) -> anyhow::Result<Option<CacheEntryValue>> {
        self.get_key_by_value("cache_entries", cache_key).await
    }

    async fn get_cache_key_by_execution_key(
        &self,
        execution_cache_key: &ExecutionCacheKey,
    ) -> anyhow::Result<Option<CacheEntryKey>> {
        self.get_key_by_value("task_fingerprints", execution_cache_key).await
    }

    #[expect(
        clippy::significant_drop_tightening,
        reason = "lock guard must be held while executing the prepared statement"
    )]
    async fn upsert<K: Encode, V: Encode>(
        &self,
        table: &str,
        key: &K,
        value: &V,
    ) -> anyhow::Result<()> {
        let key_blob = encode_to_vec(key, BINCODE_CONFIG)?;
        let value_blob = encode_to_vec(value, BINCODE_CONFIG)?;
        let conn = self.conn.lock().await;
        #[expect(clippy::disallowed_macros, reason = "SQL query string for rusqlite requires String")]
        let mut update_stmt = conn.prepare_cached(&format!(
            "INSERT INTO {table} (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2"
        ))?;
        update_stmt.execute([key_blob, value_blob])?;
        Ok(())
    }

    async fn upsert_cache_entry(
        &self,
        cache_key: &CacheEntryKey,
        cache_value: &CacheEntryValue,
    ) -> anyhow::Result<()> {
        self.upsert("cache_entries", cache_key, cache_value).await
    }

    async fn upsert_task_fingerprint(
        &self,
        execution_cache_key: &ExecutionCacheKey,
        cache_entry_key: &CacheEntryKey,
    ) -> anyhow::Result<()> {
        self.upsert("task_fingerprints", execution_cache_key, cache_entry_key).await
    }

    #[expect(
        clippy::significant_drop_tightening,
        reason = "lock guard must be held while iterating over query rows"
    )]
    async fn list_table<K: Decode<()> + Serialize, V: Decode<()> + Serialize>(
        &self,
        table: &str,
        out: &mut impl Write,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().await;
        #[expect(
            clippy::disallowed_macros,
            reason = "SQL query string for rusqlite requires String"
        )]
        let mut select_stmt = conn.prepare_cached(&format!("SELECT key, value FROM {table}"))?;
        let mut rows = select_stmt.query([])?;
        while let Some(row) = rows.next()? {
            let key_blob: Vec<u8> = row.get(0)?;
            let value_blob: Vec<u8> = row.get(1)?;
            let (key, _) = decode_from_slice::<K, _>(&key_blob, BINCODE_CONFIG)?;
            let (value, _) = decode_from_slice::<V, _>(&value_blob, BINCODE_CONFIG)?;
            writeln!(
                out,
                "{} => {}",
                serde_json::to_string_pretty(&key)?,
                serde_json::to_string_pretty(&value)?
            )?;
        }
        Ok(())
    }

    pub async fn list(&self, mut out: impl Write) -> anyhow::Result<()> {
        out.write_all(b"------- task_fingerprints -------\n")?;
        self.list_table::<ExecutionCacheKey, CacheEntryKey>("task_fingerprints", &mut out).await?;
        out.write_all(b"------- cache_entries -------\n")?;
        self.list_table::<CacheEntryKey, CacheEntryValue>("cache_entries", &mut out).await?;
        Ok(())
    }
}
