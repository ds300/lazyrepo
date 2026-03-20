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

#[cfg(windows)]
const WINDOWS_FIXTURE_PATH: &str = r"tests\fixtures\hello.txt";
#[cfg(windows)]
const WINDOWS_MISSING_FIXTURE_PATH: &str = r"tests\fixtures\does_not_exist.txt";

fn shell_command(command: impl Into<String>) -> Vec<String> {
    let command = command.into();
    #[cfg(windows)]
    {
        vec![
            "cmd".to_string(),
            "/c".to_string(),
            command,
        ]
    }
    #[cfg(not(windows))]
    {
        vec!["bash".to_string(), "-c".to_string(), command]
    }
}

#[test]
fn test_read_tracking() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();
    let fixture_path = fixtures_dir().join("hello.txt");
    let fixture_str = fixture_path.to_str().unwrap();

    let mut args = vec!["--output".to_string(), output_path.to_string(), "--".to_string()];
    #[cfg(windows)]
    args.extend(shell_command(format!("type {WINDOWS_FIXTURE_PATH}")));
    #[cfg(not(windows))]
    {
        args.push("cat".to_string());
        args.push(fixture_str.to_string());
    }

    fspy_trace()
        .args(&args)
        .assert()
        .success()
        .stdout(predicate::str::contains("hello from test fixture"));

    let json = std::fs::read_to_string(output_path).unwrap();
    let accesses: Vec<FileAccess> = serde_json::from_str(&json).unwrap();

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

    let mut args = vec!["--output".to_string(), output_path.to_string(), "--".to_string()];
    #[cfg(windows)]
    args.extend(shell_command(format!("echo test>{write_target_path}")));
    #[cfg(not(windows))]
    args.extend(shell_command(format!("echo test > {write_target_path}")));

    fspy_trace()
        .args(&args)
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

    let mut args = vec!["--output".to_string(), output_path.to_string(), "--".to_string()];
    args.extend(shell_command("exit 42"));

    fspy_trace()
        .args(&args)
        .assert()
        .code(42);
}

#[test]
fn test_stdio_passthrough() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();

    let mut args = vec!["--output".to_string(), output_path.to_string(), "--".to_string()];
    #[cfg(windows)]
    args.extend(shell_command("echo stdout_marker && echo stderr_marker 1>&2"));
    #[cfg(not(windows))]
    args.extend(shell_command(r#"echo "stdout_marker" && echo "stderr_marker" >&2"#));

    fspy_trace()
        .args(&args)
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

    let mut args = vec!["--output".to_string(), output_path.to_string(), "--".to_string()];
    #[cfg(windows)]
    args.extend(shell_command(format!(r#"cmd /c "type {WINDOWS_FIXTURE_PATH} > nul""#)));
    #[cfg(not(windows))]
    args.extend(shell_command(format!("bash -c 'cat {fixture_str} > /dev/null'")));

    fspy_trace()
        .args(&args)
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

    let mut args = vec!["--output".to_string(), output_path.to_string(), "--".to_string()];
    #[cfg(windows)]
    args.extend(shell_command(format!(
        "type {WINDOWS_MISSING_FIXTURE_PATH} 2>nul & exit /b 0"
    )));
    #[cfg(not(windows))]
    args.extend(shell_command(format!("cat {nonexistent_str} 2>/dev/null; true")));

    fspy_trace()
        .args(&args)
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
