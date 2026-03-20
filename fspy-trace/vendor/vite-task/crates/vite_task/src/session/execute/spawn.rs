//! Process spawning with file system tracking via fspy.

use std::{
    collections::hash_map::Entry,
    io::Write,
    process::{ExitStatus, Stdio},
    time::{Duration, Instant},
};

use bincode::{Decode, Encode};
use fspy::AccessMode;
use rustc_hash::FxHashSet;
use serde::Serialize;
use tokio::io::AsyncReadExt as _;
use vite_path::{AbsolutePath, RelativePathBuf};
use vite_task_plan::SpawnCommand;
use wax::Program as _;

use crate::collections::HashMap;

/// Path read access info
#[derive(Debug, Clone, Copy)]
pub struct PathRead {
    pub read_dir_entries: bool,
}

/// Output kind for stdout/stderr
#[derive(Debug, PartialEq, Eq, Clone, Copy, Encode, Decode, Serialize)]
pub enum OutputKind {
    StdOut,
    StdErr,
}

/// Output chunk with stream kind
#[derive(Debug, Encode, Decode, Serialize, Clone)]
pub struct StdOutput {
    pub kind: OutputKind,
    pub content: Vec<u8>,
}

/// Result of spawning a process with file tracking
#[derive(Debug)]
pub struct SpawnResult {
    pub exit_status: ExitStatus,
    pub duration: Duration,
}

/// Tracked file accesses from fspy.
/// Only populated when fspy tracking is enabled (`includes_auto` is true).
#[derive(Default, Debug)]
pub struct TrackedPathAccesses {
    /// Tracked path reads
    pub path_reads: HashMap<RelativePathBuf, PathRead>,

    /// Tracked path writes
    pub path_writes: FxHashSet<RelativePathBuf>,
}

/// Spawn a command with optional file system tracking via fspy, using piped stdio.
///
/// Returns the execution result including exit status and duration.
///
/// - stdin is always `/dev/null` (piped mode is for non-interactive execution).
/// - `stdout_writer`/`stderr_writer` receive the child's stdout/stderr output in real-time.
/// - `std_outputs` if provided, will be populated with captured outputs for cache replay.
/// - `path_accesses` if provided, fspy will be used to track file accesses. If `None`, fspy is disabled.
/// - `resolved_negatives` - resolved negative glob patterns for filtering fspy-tracked paths.
#[tracing::instrument(level = "debug", skip_all)]
#[expect(
    clippy::too_many_lines,
    reason = "spawn logic is inherently sequential and splitting would reduce clarity"
)]
pub async fn spawn_with_tracking(
    spawn_command: &SpawnCommand,
    workspace_root: &AbsolutePath,
    stdout_writer: &mut dyn Write,
    stderr_writer: &mut dyn Write,
    std_outputs: Option<&mut Vec<StdOutput>>,
    path_accesses: Option<&mut TrackedPathAccesses>,
    resolved_negatives: &[wax::Glob<'static>],
) -> anyhow::Result<SpawnResult> {
    /// The tracking state of the spawned process.
    /// Determined by whether `path_accesses` is `Some` (fspy enabled) or `None` (fspy disabled).
    enum TrackingState {
        /// fspy tracking is enabled
        FspyEnabled(fspy::TrackedChild),

        /// fspy tracking is disabled, using plain tokio process
        FspyDisabled(tokio::process::Child),
    }

    let mut cmd = fspy::Command::new(spawn_command.program_path.as_path());
    cmd.args(spawn_command.args.iter().map(vite_str::Str::as_str));
    cmd.envs(spawn_command.all_envs.iter());
    cmd.current_dir(&*spawn_command.cwd);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut tracking_state = if path_accesses.is_some() {
        // path_accesses is Some, spawn with fspy tracking enabled
        TrackingState::FspyEnabled(cmd.spawn().await?)
    } else {
        // path_accesses is None, spawn without fspy
        TrackingState::FspyDisabled(cmd.into_tokio_command().spawn()?)
    };

    let mut child_stdout = match &mut tracking_state {
        TrackingState::FspyEnabled(tracked_child) => tracked_child.stdout.take().unwrap(),
        TrackingState::FspyDisabled(tokio_child) => tokio_child.stdout.take().unwrap(),
    };
    let mut child_stderr = match &mut tracking_state {
        TrackingState::FspyEnabled(tracked_child) => tracked_child.stderr.take().unwrap(),
        TrackingState::FspyDisabled(tokio_child) => tokio_child.stderr.take().unwrap(),
    };

    // Output capturing is independent of fspy tracking
    let mut outputs = std_outputs;
    let mut stdout_buf = [0u8; 8192];
    let mut stderr_buf = [0u8; 8192];
    let mut stdout_done = false;
    let mut stderr_done = false;

    let start = Instant::now();

    // Read from both stdout and stderr concurrently using select!
    loop {
        tokio::select! {
            result = child_stdout.read(&mut stdout_buf), if !stdout_done => {
                match result? {
                    0 => stdout_done = true,
                    n => {
                        let content = stdout_buf[..n].to_vec();
                        // Write to the sync writer immediately
                        stdout_writer.write_all(&content)?;
                        stdout_writer.flush()?;
                        // Store outputs for caching
                        if let Some(outputs) = &mut outputs {
                            if let Some(last) = outputs.last_mut()
                                && last.kind == OutputKind::StdOut
                            {
                                last.content.extend(&content);
                            } else {
                                outputs.push(StdOutput { kind: OutputKind::StdOut, content });
                            }
                        }
                    }
                }
            }
            result = child_stderr.read(&mut stderr_buf), if !stderr_done => {
                match result? {
                    0 => stderr_done = true,
                    n => {
                        let content = stderr_buf[..n].to_vec();
                        // Write to the sync writer immediately
                        stderr_writer.write_all(&content)?;
                        stderr_writer.flush()?;
                        // Store outputs for caching
                        if let Some(outputs) = &mut outputs {
                            if let Some(last) = outputs.last_mut()
                                && last.kind == OutputKind::StdErr
                            {
                                last.content.extend(&content);
                            } else {
                                outputs.push(StdOutput { kind: OutputKind::StdErr, content });
                            }
                        }
                    }
                }
            }
            else => break,
        }
    }

    // Wait for process termination and process path accesses if fspy was enabled
    let (termination, path_accesses) = match tracking_state {
        TrackingState::FspyEnabled(tracked_child) => {
            let termination = tracked_child.wait_handle.await?;
            // path_accesses must be Some when fspy is enabled (they're set together)
            let path_accesses = path_accesses.ok_or_else(|| {
                anyhow::anyhow!("internal error: fspy enabled but path_accesses is None")
            })?;
            (termination, path_accesses)
        }
        TrackingState::FspyDisabled(mut tokio_child) => {
            let exit_status = tokio_child.wait().await?;
            return Ok(SpawnResult { exit_status, duration: start.elapsed() });
        }
    };
    let duration = start.elapsed();
    let path_reads = &mut path_accesses.path_reads;
    let path_writes = &mut path_accesses.path_writes;

    for access in termination.path_accesses.iter() {
        // Strip workspace root, clean `..` components, and filter in one pass.
        // fspy may report paths like `packages/sub-pkg/../shared/dist/output.js`.
        let relative_path = access.path.strip_path_prefix(workspace_root, |strip_result| {
            let Ok(stripped_path) = strip_result else {
                return None;
            };
            // On Windows, paths are possible to be still absolute after stripping the workspace root.
            // For example: c:\workspace\subdir\c:\workspace\subdir
            // Just ignore those accesses.
            let relative = RelativePathBuf::new(stripped_path).ok()?;

            // Clean `..` components — fspy may report paths like
            // `packages/sub-pkg/../shared/dist/output.js`. Normalize them for
            // consistent behavior across platforms and clean user-facing messages.
            let relative = relative.clean();

            // Skip .git directory accesses (workaround for tools like oxlint)
            if relative.as_path().strip_prefix(".git").is_ok() {
                return None;
            }

            if !resolved_negatives.is_empty()
                && resolved_negatives.iter().any(|neg| neg.is_match(relative.as_str()))
            {
                return None;
            }

            Some(relative)
        });

        let Some(relative_path) = relative_path else {
            continue;
        };

        if access.mode.contains(AccessMode::READ) {
            path_reads.entry(relative_path.clone()).or_insert(PathRead { read_dir_entries: false });
        }
        if access.mode.contains(AccessMode::WRITE) {
            path_writes.insert(relative_path.clone());
        }
        if access.mode.contains(AccessMode::READ_DIR) {
            match path_reads.entry(relative_path) {
                Entry::Occupied(mut occupied) => occupied.get_mut().read_dir_entries = true,
                Entry::Vacant(vacant) => {
                    vacant.insert(PathRead { read_dir_entries: true });
                }
            }
        }
    }

    tracing::debug!(
        "spawn finished, path_reads: {}, path_writes: {}, exit_status: {}",
        path_reads.len(),
        path_writes.len(),
        termination.status,
    );

    Ok(SpawnResult { exit_status: termination.status, duration })
}
