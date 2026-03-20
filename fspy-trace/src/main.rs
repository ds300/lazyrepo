#![feature(once_cell_try)]

use std::{path::PathBuf, process::ExitCode};

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

fn path_access_to_file_access(pa: &PathAccess<'_>) -> FileAccess {
    FileAccess {
        path: native_path_to_string(pa.path),
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

    let accesses: Vec<FileAccess> = termination
        .path_accesses
        .iter()
        .map(|pa| path_access_to_file_access(&pa))
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
