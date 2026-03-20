//! Tests for fspy tracing of statically-linked executables (seccomp path).
//! Skipped on musl: the test binary is an artifact dep targeting musl, and when
//! the CI builds with `-crt-static` the binary becomes dynamically linked,
//! defeating the purpose of these tests.
#![cfg(all(target_os = "linux", not(target_env = "musl")))]
use std::{
    fs::{self, Permissions},
    os::unix::fs::PermissionsExt as _,
    path::{Path, PathBuf},
    sync::LazyLock,
};

use fspy::PathAccessIterable;
use fspy_shared_unix::is_dynamically_linked_to_libc;
use test_log::test;

use crate::test_utils::assert_contains;

mod test_utils;

const TEST_BIN_CONTENT: &[u8] = include_bytes!(env!("CARGO_BIN_FILE_FSPY_TEST_BIN"));

fn test_bin_path() -> &'static Path {
    static TEST_BIN_PATH: LazyLock<PathBuf> = LazyLock::new(|| {
        assert_eq!(
            is_dynamically_linked_to_libc(TEST_BIN_CONTENT),
            Ok(false),
            "Test binary is not a static executable"
        );

        let tmp_dir = env!("CARGO_TARGET_TMPDIR");
        let test_bin_path = PathBuf::from(tmp_dir).join("fspy-test-bin");
        fs::write(&test_bin_path, TEST_BIN_CONTENT).expect("failed to write test binary");
        fs::set_permissions(&test_bin_path, Permissions::from_mode(0o755))
            .expect("failed to set permissions on test binary");

        test_bin_path
    });
    TEST_BIN_PATH.as_path()
}

async fn track_test_bin(args: &[&str], cwd: Option<&str>) -> PathAccessIterable {
    let mut cmd = fspy::Command::new(test_bin_path());
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.args(args);
    let tracked_child = cmd.spawn().await.unwrap();

    let termination = tracked_child.wait_handle.await.unwrap();
    assert!(termination.status.success());

    termination.path_accesses
}

#[test(tokio::test)]
async fn open_read() {
    let accesses = track_test_bin(&["open_read", "/hello"], None).await;
    assert_contains(&accesses, Path::new("/hello"), fspy::AccessMode::READ);
}

#[test(tokio::test)]
async fn open_write() {
    let accesses = track_test_bin(&["open_write", "/hello"], None).await;
    assert_contains(&accesses, Path::new("/hello"), fspy::AccessMode::WRITE);
}

#[test(tokio::test)]
async fn open_readwrite() {
    let accesses = track_test_bin(&["open_readwrite", "/hello"], None).await;
    assert_contains(
        &accesses,
        Path::new("/hello"),
        fspy::AccessMode::READ | fspy::AccessMode::WRITE,
    );
}

#[test(tokio::test)]
async fn openat2_read() {
    let accesses = track_test_bin(&["openat2_read", "/hello"], None).await;
    assert_contains(&accesses, Path::new("/hello"), fspy::AccessMode::READ);
}

#[test(tokio::test)]
async fn openat2_write() {
    let accesses = track_test_bin(&["openat2_write", "/hello"], None).await;
    assert_contains(&accesses, Path::new("/hello"), fspy::AccessMode::WRITE);
}

#[test(tokio::test)]
async fn openat2_readwrite() {
    let accesses = track_test_bin(&["openat2_readwrite", "/hello"], None).await;
    assert_contains(
        &accesses,
        Path::new("/hello"),
        fspy::AccessMode::READ | fspy::AccessMode::WRITE,
    );
}

#[test(tokio::test)]
async fn open_relative() {
    let accesses = track_test_bin(&["open_read", "hello"], Some("/home")).await;
    assert_contains(&accesses, Path::new("/home/hello"), fspy::AccessMode::READ);
}

#[test(tokio::test)]
async fn readdir() {
    let accesses = track_test_bin(&["readdir", "/home"], None).await;
    assert_contains(&accesses, Path::new("/home"), fspy::AccessMode::READ_DIR);
}

#[test(tokio::test)]
async fn stat() {
    let accesses = track_test_bin(&["stat", "/hello"], None).await;
    assert_contains(&accesses, Path::new("/hello"), fspy::AccessMode::READ);
}

#[test(tokio::test)]
async fn execve() {
    let accesses = track_test_bin(&["execve", "/hello"], None).await;
    assert_contains(&accesses, Path::new("/hello"), fspy::AccessMode::READ);
}
