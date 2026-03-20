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

fn temp_path_in_cwd(name: &str) -> PathBuf {
    let dir = tempfile::tempdir_in(std::env::current_dir().unwrap()).unwrap();
    let path = dir.path().join(name);
    std::mem::forget(dir);
    path
}

#[cfg(windows)]
const WINDOWS_FIXTURE_PATH: &str = r"tests\fixtures\hello.txt";
#[cfg(windows)]
const WINDOWS_MISSING_FIXTURE_PATH: &str = r"tests\fixtures\does_not_exist.txt";

fn node_command(script: &str, args: &[&str]) -> Vec<String> {
    let mut command = vec!["node".to_string(), "-e".to_string(), script.to_string()];
    command.extend(args.iter().map(|arg| (*arg).to_string()));
    command
}

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
    args.extend(node_command(
        "try { require('node:fs').readFileSync(process.argv[1]) } catch {}",
        &[WINDOWS_FIXTURE_PATH],
    ));
    #[cfg(not(windows))]
    args.extend(node_command(
        "try { require('node:fs').readFileSync(process.argv[1]) } catch {}",
        &[fixture_str],
    ));

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
        "should track read of {fixture_str}; accesses={accesses:#?}"
    );
}

#[test]
fn test_write_tracking() {
    let output_file = tempfile::NamedTempFile::new().unwrap();
    let output_path = output_file.path().to_str().unwrap();
    let write_target = temp_path_in_cwd("write-target.txt");
    let write_target_path = write_target.to_str().unwrap();

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
    args.extend(node_command(
        "try { require('node:child_process').spawnSync(process.argv[1], process.argv.slice(2), { stdio: 'ignore' }) } catch {}",
        &["cmd", "/c", &format!("type {WINDOWS_FIXTURE_PATH}")],
    ));
    #[cfg(not(windows))]
    args.extend(node_command(
        "try { require('node:child_process').spawnSync(process.argv[1], process.argv.slice(2), { stdio: 'ignore' }) } catch {}",
        &["bash", "-c", &format!("cat {fixture_str} > /dev/null")],
    ));

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
        "should track grandchild read of {fixture_str}; accesses={accesses:#?}"
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
    args.extend(node_command(
        "try { require('node:fs').existsSync(process.argv[1]) } catch {}",
        &[WINDOWS_MISSING_FIXTURE_PATH],
    ));
    #[cfg(not(windows))]
    args.extend(node_command(
        "try { require('node:fs').existsSync(process.argv[1]) } catch {}",
        &[nonexistent_str],
    ));

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
        "should track probe for nonexistent file {nonexistent_str}; accesses={accesses:#?}"
    );
}
