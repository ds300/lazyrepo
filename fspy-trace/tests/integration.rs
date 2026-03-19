use std::path::PathBuf;

use assert_cmd::Command;
use predicates::prelude::*;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
struct FileAccess {
    path: String,
    mode: String,
}

fn fspy_trace() -> Command {
    Command::cargo_bin("fspy-trace").expect("binary should be buildable")
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

#[test]
fn test_read_tracking() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();
    let fixture_path = fixtures_dir().join("hello.txt");

    fspy_trace()
        .args(["--output", output_path, "--", "cat"])
        .arg(&fixture_path)
        .assert()
        .success()
        .stdout(predicate::str::contains("hello from test fixture"));

    let json = std::fs::read_to_string(output_path).unwrap();
    let accesses: Vec<FileAccess> = serde_json::from_str(&json).unwrap();

    let fixture_str = fixture_path.to_str().unwrap();
    let reads: Vec<_> = accesses
        .iter()
        .filter(|a| a.path == fixture_str && a.mode.contains("read"))
        .collect();
    assert!(!reads.is_empty(), "should track read of {fixture_str}");
}

#[test]
fn test_write_tracking() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();
    let write_target = tempfile::NamedTempFile::new().unwrap();
    let write_target_path = write_target.path().to_str().unwrap();

    fspy_trace()
        .args([
            "--output",
            output_path,
            "--",
            "bash",
            "-c",
            &format!("echo test > {write_target_path}"),
        ])
        .assert()
        .success();

    let json = std::fs::read_to_string(output_path).unwrap();
    let accesses: Vec<FileAccess> = serde_json::from_str(&json).unwrap();

    let writes: Vec<_> = accesses
        .iter()
        .filter(|a| a.path == write_target_path && a.mode.contains("write"))
        .collect();
    assert!(
        !writes.is_empty(),
        "should track write to {write_target_path}"
    );
}

#[test]
fn test_exit_code_forwarding() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();

    fspy_trace()
        .args(["--output", output_path, "--", "bash", "-c", "exit 42"])
        .assert()
        .code(42);
}

#[test]
fn test_stdio_passthrough() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();

    fspy_trace()
        .args([
            "--output",
            output_path,
            "--",
            "bash",
            "-c",
            r#"echo "stdout_marker" && echo "stderr_marker" >&2"#,
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("stdout_marker"))
        .stderr(predicate::str::contains("stderr_marker"));
}

#[test]
fn test_child_process_inheritance() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();
    let fixture_path = fixtures_dir().join("hello.txt");
    let fixture_str = fixture_path.to_str().unwrap();

    fspy_trace()
        .args([
            "--output",
            output_path,
            "--",
            "bash",
            "-c",
            &format!("bash -c 'cat {fixture_str} > /dev/null'"),
        ])
        .assert()
        .success();

    let json = std::fs::read_to_string(output_path).unwrap();
    let accesses: Vec<FileAccess> = serde_json::from_str(&json).unwrap();

    let reads: Vec<_> = accesses
        .iter()
        .filter(|a| a.path == fixture_str && a.mode.contains("read"))
        .collect();
    assert!(
        !reads.is_empty(),
        "should track grandchild read of {fixture_str}"
    );
}

#[test]
fn test_missing_file_probe() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();

    let nonexistent = fixtures_dir().join("does_not_exist.txt");
    let nonexistent_str = nonexistent.to_str().unwrap();

    fspy_trace()
        .args([
            "--output",
            output_path,
            "--",
            "bash",
            "-c",
            &format!("cat {nonexistent_str} 2>/dev/null; true"),
        ])
        .assert()
        .success();

    let json = std::fs::read_to_string(output_path).unwrap();
    let accesses: Vec<FileAccess> = serde_json::from_str(&json).unwrap();

    let probes: Vec<_> = accesses
        .iter()
        .filter(|a| a.path == nonexistent_str)
        .collect();
    assert!(
        !probes.is_empty(),
        "should track probe for nonexistent file {nonexistent_str}"
    );
}
