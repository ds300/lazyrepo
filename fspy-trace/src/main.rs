#![feature(once_cell_try)]

use std::{
    path::{Path, PathBuf},
    process::ExitCode,
};

use clap::Parser;
use fspy::PathAccess;
use fspy_shared::ipc::AccessMode;
use fspy_shared::ipc::NativePath;
use bytemuck::TransparentWrapper;
use serde::Serialize;

#[derive(Parser)]
#[command(
    name = "fspy-trace",
    about = "Run a command and track which files it accesses"
)]
struct Cli {
    /// Path to write the file access JSON log
    #[arg(long)]
    output: PathBuf,

    /// The command and arguments to run (after --)
    #[arg(trailing_var_arg = true, required = true)]
    command: Vec<String>,
}

#[derive(Serialize)]
struct FileAccess {
    path: String,
    mode: String,
}

fn access_mode_to_string(mode: AccessMode) -> String {
    let mut parts = Vec::new();
    if mode.contains(AccessMode::READ) {
        parts.push("read");
    }
    if mode.contains(AccessMode::WRITE) {
        parts.push("write");
    }
    if mode.contains(AccessMode::READ_DIR) {
        parts.push("readdir");
    }
    if parts.is_empty() {
        return "unknown".to_string();
    }
    parts.join("+")
}

fn native_path_to_string(path: &NativePath) -> String {
    let native_str: &fspy_shared::ipc::NativeStr = NativePath::peel_ref(path);
    native_str.to_cow_os_str().to_string_lossy().into_owned()
}

fn sanitize_windows_path_prefix(path: String) -> String {
    #[cfg(windows)]
    for prefix in [r"\\?\", r"\\.\", r"\??\"] {
        if let Some(stripped) = path.strip_prefix(prefix) {
            return stripped.to_string();
        }
    }
    path
}

fn normalize_access_path(path: &NativePath, cwd: &Path) -> String {
    let relative_to_cwd = path.strip_path_prefix(cwd, |result| result.ok().map(Path::to_path_buf));
    if let Some(relative_to_cwd) = relative_to_cwd {
        return cwd.join(relative_to_cwd).to_string_lossy().into_owned();
    }

    let raw = sanitize_windows_path_prefix(native_path_to_string(path));
    if let Ok(canonical) = std::fs::canonicalize(&raw) {
        return canonical.to_string_lossy().into_owned();
    }

    #[cfg(windows)]
    {
        if let Ok(relative_to_cwd) =
            std::path::Path::new(&raw).strip_prefix(cwd).map(Path::to_path_buf)
        {
            return cwd.join(relative_to_cwd).to_string_lossy().into_owned();
        }
    }
    raw
}

fn path_access_to_file_access(pa: &PathAccess<'_>, cwd: &Path) -> FileAccess {
    FileAccess {
        path: normalize_access_path(pa.path, cwd),
        mode: access_mode_to_string(pa.mode),
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    if cli.command.is_empty() {
        eprintln!("fspy-trace: no command specified");
        return ExitCode::from(1);
    }

    let program = &cli.command[0];
    let args = &cli.command[1..];

    let mut cmd = fspy::Command::new(program);
    cmd.args(args);
    cmd.envs(std::env::vars_os());
    if let Ok(cwd) = std::env::current_dir() {
        cmd.current_dir(&cwd);
    }
    cmd.stdout(std::process::Stdio::inherit());
    cmd.stderr(std::process::Stdio::inherit());
    cmd.stdin(std::process::Stdio::inherit());

    let tracked_child = match cmd.spawn().await {
        Ok(child) => child,
        Err(err) => {
            eprintln!("fspy-trace: failed to spawn command: {err}");
            return ExitCode::from(127);
        }
    };

    let termination = match tracked_child.wait_handle.await {
        Ok(t) => t,
        Err(err) => {
            eprintln!("fspy-trace: error waiting for child: {err}");
            return ExitCode::from(1);
        }
    };

    let serialization_cwd = std::env::current_dir()
        .ok()
        .and_then(|cwd| std::fs::canonicalize(cwd).ok())
        .unwrap_or_else(|| PathBuf::from("."));
    let accesses: Vec<FileAccess> = termination
        .path_accesses
        .iter()
        .map(|pa| path_access_to_file_access(&pa, &serialization_cwd))
        .collect();

    match serde_json::to_string_pretty(&accesses) {
        Ok(json) => {
            if let Err(err) = std::fs::write(&cli.output, json) {
                eprintln!("fspy-trace: failed to write output file: {err}");
            }
        }
        Err(err) => {
            eprintln!("fspy-trace: failed to serialize accesses: {err}");
        }
    }

    let code = termination.status.code().unwrap_or(1);
    ExitCode::from(code.clamp(0, 255) as u8)
}
