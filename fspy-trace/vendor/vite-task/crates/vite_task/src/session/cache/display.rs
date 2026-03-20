//! Human-readable formatting for cache status
//!
//! This module provides plain text formatting for cache status.
//! Coloring is handled by the reporter to respect `NO_COLOR` environment variable.

use rustc_hash::FxHashSet;
use serde::{Deserialize, Serialize};
use vite_str::Str;
use vite_task_plan::cache_metadata::SpawnFingerprint;

use super::{CacheMiss, FingerprintMismatch, InputChangeKind, split_path};
use crate::session::event::CacheStatus;

/// Describes a single atomic change between two spawn fingerprints.
///
/// Used both for live cache status display and for persisted summary data.
#[derive(Serialize, Deserialize)]
pub enum SpawnFingerprintChange {
    // Environment variable changes
    /// Environment variable added
    EnvAdded { key: Str, value: Str },
    /// Environment variable removed
    EnvRemoved { key: Str, value: Str },
    /// Environment variable value changed
    EnvValueChanged { key: Str, old_value: Str, new_value: Str },

    // Untracked env config changes
    /// Untracked env pattern added
    UntrackedEnvAdded { name: Str },
    /// Untracked env pattern removed
    UntrackedEnvRemoved { name: Str },

    // Command changes
    /// Program changed
    ProgramChanged,
    /// Args changed
    ArgsChanged,

    // Working directory change
    /// Working directory changed
    CwdChanged,
}

/// Format a single spawn fingerprint change as human-readable text.
///
/// Used by both the live cache status display and the persisted summary rendering.
pub fn format_spawn_change(change: &SpawnFingerprintChange) -> Str {
    match change {
        SpawnFingerprintChange::EnvAdded { key, value } => {
            vite_str::format!("env {key}={value} added")
        }
        SpawnFingerprintChange::EnvRemoved { key, value } => {
            vite_str::format!("env {key}={value} removed")
        }
        SpawnFingerprintChange::EnvValueChanged { key, old_value, new_value } => {
            vite_str::format!("env {key} value changed from '{old_value}' to '{new_value}'")
        }
        SpawnFingerprintChange::UntrackedEnvAdded { name } => {
            vite_str::format!("untracked env '{name}' added")
        }
        SpawnFingerprintChange::UntrackedEnvRemoved { name } => {
            vite_str::format!("untracked env '{name}' removed")
        }
        SpawnFingerprintChange::ProgramChanged => Str::from("program changed"),
        SpawnFingerprintChange::ArgsChanged => Str::from("args changed"),
        SpawnFingerprintChange::CwdChanged => Str::from("working directory changed"),
    }
}

/// Compare two spawn fingerprints and return all changes.
pub fn detect_spawn_fingerprint_changes(
    old: &SpawnFingerprint,
    new: &SpawnFingerprint,
) -> Vec<SpawnFingerprintChange> {
    let mut changes = Vec::new();
    let old_env = old.env_fingerprints();
    let new_env = new.env_fingerprints();

    // Check for removed or changed envs
    for (key, old_value) in &old_env.fingerprinted_envs {
        if let Some(new_value) = new_env.fingerprinted_envs.get(key) {
            if old_value != new_value {
                changes.push(SpawnFingerprintChange::EnvValueChanged {
                    key: key.clone(),
                    old_value: Str::from(old_value.as_ref()),
                    new_value: Str::from(new_value.as_ref()),
                });
            }
        } else {
            changes.push(SpawnFingerprintChange::EnvRemoved {
                key: key.clone(),
                value: Str::from(old_value.as_ref()),
            });
        }
    }

    // Check for added envs
    for (key, new_value) in &new_env.fingerprinted_envs {
        if !old_env.fingerprinted_envs.contains_key(key) {
            changes.push(SpawnFingerprintChange::EnvAdded {
                key: key.clone(),
                value: Str::from(new_value.as_ref()),
            });
        }
    }

    // Check untracked env config changes
    let old_untracked: FxHashSet<_> = old_env.untracked_env_config.iter().collect();
    let new_untracked: FxHashSet<_> = new_env.untracked_env_config.iter().collect();
    for name in old_untracked.difference(&new_untracked) {
        changes.push(SpawnFingerprintChange::UntrackedEnvRemoved { name: (*name).clone() });
    }
    for name in new_untracked.difference(&old_untracked) {
        changes.push(SpawnFingerprintChange::UntrackedEnvAdded { name: (*name).clone() });
    }

    // Check program changes
    if old.program_fingerprint_debug() != new.program_fingerprint_debug() {
        changes.push(SpawnFingerprintChange::ProgramChanged);
    }

    // Check args changes
    if old.args() != new.args() {
        changes.push(SpawnFingerprintChange::ArgsChanged);
    }

    // Check cwd changes
    if old.cwd() != new.cwd() {
        changes.push(SpawnFingerprintChange::CwdChanged);
    }

    changes
}

/// Format cache status for inline display (during Start event).
///
/// Returns `Some(formatted_string)` for Hit, Miss with reason, and Disabled, None for `NotFound`.
/// - Cache Hit: Shows "cache hit" indicator
/// - Cache Miss (NotFound): No inline message (just command)
/// - Cache Miss (with mismatch): Shows "cache miss" with brief reason
/// - Cache Disabled: Shows "cache disabled" with reason
///
/// Note: Returns plain text without styling. The reporter applies colors.
pub fn format_cache_status_inline(cache_status: &CacheStatus) -> Option<Str> {
    match cache_status {
        CacheStatus::Hit { .. } => {
            // Show "cache hit" indicator when replaying from cache
            Some(Str::from("◉ cache hit, replaying"))
        }
        CacheStatus::Miss(CacheMiss::NotFound) => {
            // No inline message for "not found" case - just show command
            // This keeps the output clean for first-time executions
            None
        }
        CacheStatus::Miss(CacheMiss::FingerprintMismatch(mismatch)) => {
            // Show "cache miss" with reason why cache couldn't be used
            let reason = match mismatch {
                FingerprintMismatch::SpawnFingerprint { old, new } => {
                    let changes = detect_spawn_fingerprint_changes(old, new);
                    match changes.first() {
                        Some(
                            SpawnFingerprintChange::EnvAdded { .. }
                            | SpawnFingerprintChange::EnvRemoved { .. }
                            | SpawnFingerprintChange::EnvValueChanged { .. },
                        ) => "envs changed",
                        Some(
                            SpawnFingerprintChange::UntrackedEnvAdded { .. }
                            | SpawnFingerprintChange::UntrackedEnvRemoved { .. },
                        ) => "untracked env config changed",
                        Some(SpawnFingerprintChange::ProgramChanged) => "program changed",
                        Some(SpawnFingerprintChange::ArgsChanged) => "args changed",
                        Some(SpawnFingerprintChange::CwdChanged) => "working directory changed",
                        None => "configuration changed",
                    }
                }
                FingerprintMismatch::InputConfig => "input configuration changed",
                FingerprintMismatch::InputChanged { kind, path } => {
                    let desc = format_input_change_str(*kind, path.as_str());
                    return Some(vite_str::format!("○ cache miss: {desc}, executing"));
                }
            };
            Some(vite_str::format!("○ cache miss: {reason}, executing"))
        }
        CacheStatus::Disabled(_) => Some(Str::from("⊘ cache disabled")),
    }
}

/// Format an input change as a [`Str`] for inline display.
pub fn format_input_change_str(kind: InputChangeKind, path: &str) -> Str {
    match kind {
        InputChangeKind::ContentModified => vite_str::format!("'{path}' modified"),
        InputChangeKind::Added => {
            let (dir, filename) = split_path(path);
            dir.map_or_else(
                || vite_str::format!("'{filename}' added in workspace root"),
                |dir| vite_str::format!("'{filename}' added in '{dir}'"),
            )
        }
        InputChangeKind::Removed => {
            let (dir, filename) = split_path(path);
            dir.map_or_else(
                || vite_str::format!("'{filename}' removed from workspace root"),
                |dir| vite_str::format!("'{filename}' removed from '{dir}'"),
            )
        }
    }
}
