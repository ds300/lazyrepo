#![cfg_attr(target_os = "windows", feature(windows_process_extensions_main_thread_handle))]
#![feature(once_cell_try)]

// Persist the injected DLL/shared library somewhere in the filesystem.
// Not needed on musl (seccomp-only tracking).
#[cfg(not(target_env = "musl"))]
mod artifact;

pub mod error;

mod ipc;

#[cfg(unix)]
#[path = "./unix/mod.rs"]
mod os_impl;

#[cfg(target_os = "windows")]
#[path = "./windows/mod.rs"]
mod os_impl;

#[cfg(unix)]
mod arena;
mod command;

use std::{env::temp_dir, fs::create_dir, io, process::ExitStatus, sync::LazyLock};

pub use command::Command;
pub use fspy_shared::ipc::{AccessMode, PathAccess};
use futures_util::future::BoxFuture;
pub use os_impl::PathAccessIterable;
use os_impl::SpyImpl;
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};

/// The result of a tracked child process upon its termination.
pub struct ChildTermination {
    /// The exit status of the child process.
    pub status: ExitStatus,
    /// The path accesses captured from the child process.
    pub path_accesses: PathAccessIterable,
}

pub struct TrackedChild {
    /// The handle for writing to the child's standard input (stdin), if it has
    /// been captured.
    pub stdin: Option<ChildStdin>,

    /// The handle for reading from the child's standard output (stdout), if it
    /// has been captured.
    pub stdout: Option<ChildStdout>,

    /// The handle for reading from the child's standard error (stderr), if it
    /// has been captured.
    pub stderr: Option<ChildStderr>,

    /// The future that resolves to exit status and path accesses when the process exits.
    pub wait_handle: BoxFuture<'static, io::Result<ChildTermination>>,
}

pub(crate) static SPY_IMPL: LazyLock<SpyImpl> = LazyLock::new(|| {
    let tmp_dir = temp_dir().join("fspy");
    let _ = create_dir(&tmp_dir);
    SpyImpl::init_in(&tmp_dir).expect("Failed to initialize global spy")
});
