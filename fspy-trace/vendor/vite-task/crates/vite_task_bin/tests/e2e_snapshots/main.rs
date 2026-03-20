mod redact;

use std::{
    env::{self, join_paths, split_paths},
    ffi::OsStr,
    io::Write,
    sync::{Arc, Mutex, mpsc},
    time::Duration,
};

use cp_r::CopyOptions;
use pathdiff::diff_paths;
use pty_terminal::{geo::ScreenSize, terminal::CommandBuilder};
use pty_terminal_test::TestTerminal;
use redact::redact_e2e_output;
use vite_path::{AbsolutePath, AbsolutePathBuf, RelativePathBuf};
use vite_str::Str;
use vite_workspace::find_workspace_root;

/// Timeout for each step in e2e tests.
/// Windows CI needs a longer timeout due to Git Bash startup overhead and slower I/O.
const STEP_TIMEOUT: Duration =
    if cfg!(windows) { Duration::from_secs(60) } else { Duration::from_secs(20) };

/// Screen size for the PTY terminal. Large enough to avoid line wrapping.
const SCREEN_SIZE: ScreenSize = ScreenSize { rows: 500, cols: 500 };

const COMPILE_TIME_VT_PATH: &str = env!("CARGO_BIN_EXE_vt");
const COMPILE_TIME_MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

/// Get the shell executable for running e2e test steps.
/// On Unix, uses /bin/sh.
/// On Windows, uses BASH env var or falls back to Git Bash.
#[expect(
    clippy::disallowed_types,
    reason = "PathBuf required for CommandBuilder and std::path operations on shell executable"
)]
fn get_shell_exe() -> std::path::PathBuf {
    if cfg!(windows) {
        std::env::var_os("BASH").map_or_else(
            || {
                let git_bash = std::path::PathBuf::from(r"C:\Program Files\Git\bin\bash.exe");
                if git_bash.exists() {
                    git_bash
                } else {
                    panic!(
                        "Could not find bash executable for e2e tests.\n\
                         Please set the BASH environment variable to point to a bash executable,\n\
                         or install Git for Windows which provides bash at:\n\
                         C:\\Program Files\\Git\\bin\\bash.exe"
                    );
                }
            },
            std::path::PathBuf::from,
        )
    } else {
        std::path::PathBuf::from("/bin/sh")
    }
}

#[expect(
    clippy::disallowed_types,
    reason = "PathBuf required for compile-time/runtime vt path remapping"
)]
fn resolve_runtime_vt_path() -> AbsolutePathBuf {
    let compile_time_vt = std::path::PathBuf::from(COMPILE_TIME_VT_PATH);
    let compile_time_manifest = std::path::PathBuf::from(COMPILE_TIME_MANIFEST_DIR);
    let runtime_manifest =
        std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());

    let compile_time_repo_root = compile_time_manifest.parent().unwrap().parent().unwrap();
    let runtime_repo_root = runtime_manifest.parent().unwrap().parent().unwrap();

    let relative_vt = diff_paths(&compile_time_vt, compile_time_repo_root).unwrap_or_else(|| {
        panic!(
            "Failed to diff vt path. vt={} repo_root={}",
            compile_time_vt.display(),
            compile_time_repo_root.display(),
        )
    });
    let runtime_vt = runtime_repo_root.join(&relative_vt);

    assert!(
        runtime_vt.exists(),
        "Remapped vt path does not exist: {} (relative: {})",
        runtime_vt.display(),
        relative_vt.display(),
    );

    AbsolutePathBuf::new(runtime_vt).unwrap()
}

#[derive(serde::Deserialize, Debug)]
#[serde(untagged)]
enum Step {
    Command(Str),
    Detailed(StepConfig),
}

#[derive(serde::Deserialize, Debug)]
#[serde(deny_unknown_fields)]
struct StepConfig {
    command: Str,
    #[serde(default)]
    interactions: Vec<Interaction>,
}

impl Step {
    fn command(&self) -> &str {
        match self {
            Self::Command(command) => command.as_str(),
            Self::Detailed(config) => config.command.as_str(),
        }
    }

    fn interactions(&self) -> &[Interaction] {
        match self {
            Self::Command(_) => &[],
            Self::Detailed(config) => &config.interactions,
        }
    }
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(untagged)]
enum Interaction {
    ExpectMilestone(ExpectMilestoneInteraction),
    Write(WriteInteraction),
    WriteLine(WriteLineInteraction),
    WriteKey(WriteKeyInteraction),
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
struct ExpectMilestoneInteraction {
    #[serde(rename = "expect-milestone")]
    expect_milestone: Str,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
struct WriteInteraction {
    write: Str,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
struct WriteLineInteraction {
    #[serde(rename = "write-line")]
    write_line: Str,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
struct WriteKeyInteraction {
    #[serde(rename = "write-key")]
    write_key: WriteKey,
}

#[derive(serde::Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum WriteKey {
    Up,
    Down,
    Enter,
    Escape,
    Backspace,
}

impl WriteKey {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Up => "up",
            Self::Down => "down",
            Self::Enter => "enter",
            Self::Escape => "escape",
            Self::Backspace => "backspace",
        }
    }

    const fn bytes(self) -> &'static [u8] {
        match self {
            Self::Up => b"\x1b[A",
            Self::Down => b"\x1b[B",
            Self::Enter => b"\r",
            Self::Escape => b"\x1b",
            Self::Backspace => b"\x7f",
        }
    }
}

#[derive(serde::Deserialize, Debug)]
struct E2e {
    pub name: Str,
    #[serde(default)]
    pub cwd: RelativePathBuf,
    pub steps: Vec<Step>,
    /// Optional platform filter: "unix" or "windows". If set, test only runs on that platform.
    #[serde(default)]
    pub platform: Option<Str>,
}

#[derive(serde::Deserialize, Default)]
struct SnapshotsFile {
    #[serde(rename = "e2e", default)] // toml usually uses singular for arrays
    pub e2e_cases: Vec<E2e>,
}

#[expect(clippy::disallowed_types, reason = "Path required by insta::glob! callback signature")]
fn run_case(tmpdir: &AbsolutePath, fixture_path: &std::path::Path, filter: Option<&str>) {
    let fixture_name = fixture_path.file_name().unwrap().to_str().unwrap();
    if fixture_name.starts_with('.') {
        return; // skip hidden files like .DS_Store
    }

    // Skip if filter doesn't match
    if let Some(f) = filter
        && !fixture_name.contains(f)
    {
        return;
    }
    #[expect(clippy::print_stdout, reason = "test progress output for e2e test runner")]
    {
        println!("{fixture_name}");
    }
    // Configure insta to write snapshots to fixture directory
    let mut settings = insta::Settings::clone_current();
    settings.set_snapshot_path(fixture_path.join("snapshots"));
    settings.set_prepend_module_to_snapshot(false);
    settings.remove_snapshot_suffix();

    settings.bind(|| run_case_inner(tmpdir, fixture_path, fixture_name));
}

enum TerminationState {
    Exited(i64),
    TimedOut,
}

#[expect(
    clippy::too_many_lines,
    reason = "e2e test runner with process management necessarily has many lines"
)]
#[expect(
    clippy::disallowed_types,
    reason = "Path required by insta::glob! callback; String required by from_utf8_lossy and string accumulation"
)]
fn run_case_inner(tmpdir: &AbsolutePath, fixture_path: &std::path::Path, fixture_name: &str) {
    // Copy the case directory to a temporary directory to avoid discovering workspace outside of the test case.
    let stage_path = tmpdir.join(fixture_name);
    CopyOptions::new().copy_tree(fixture_path, stage_path.as_path()).unwrap();

    let (workspace_root, _cwd) = find_workspace_root(&stage_path).unwrap();

    assert_eq!(
        &stage_path, &*workspace_root.path,
        "folder '{fixture_name}' should be a workspace root"
    );

    let cases_toml_path = fixture_path.join("snapshots.toml");
    let cases_file: SnapshotsFile = match std::fs::read(&cases_toml_path) {
        Ok(content) => toml::from_slice(&content).unwrap(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => SnapshotsFile::default(),
        Err(err) => panic!("Failed to read cases.toml for fixture {fixture_name}: {err}"),
    };

    // Navigate from runtime CARGO_MANIFEST_DIR to packages/tools at the repo root.
    #[expect(
        clippy::disallowed_types,
        reason = "Path required for CARGO_MANIFEST_DIR path traversal"
    )]
    let repo_root = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let repo_root = repo_root.parent().unwrap().parent().unwrap();
    let test_bin_path = Arc::<OsStr>::from(
        repo_root.join("packages").join("tools").join("node_modules").join(".bin").into_os_string(),
    );

    // Get shell executable for running steps
    let shell_exe = get_shell_exe();

    // Prepare PATH for e2e tests
    let e2e_env_path = join_paths(
        [
            // Include vt binary path to PATH so that e2e tests can run "vt ..." commands.
            {
                let vt_path = resolve_runtime_vt_path();
                let vt_dir = vt_path.parent().unwrap();
                vt_dir.as_path().as_os_str().into()
            },
            // Include packages/tools to PATH so that e2e tests can run utilities such as replace-file-content.
            test_bin_path,
        ]
        .into_iter()
        .chain(
            // the existing PATH
            split_paths(&env::var_os("PATH").unwrap())
                .map(|path| Arc::<OsStr>::from(path.into_os_string())),
        ),
    )
    .unwrap();

    let mut e2e_count = 0u32;
    for e2e in cases_file.e2e_cases {
        // Skip test if platform doesn't match
        if let Some(platform) = &e2e.platform {
            let should_run = match platform.as_str() {
                "unix" => cfg!(unix),
                "windows" => cfg!(windows),
                other => panic!("Unknown platform '{}' in test '{}'", other, e2e.name),
            };
            if !should_run {
                continue;
            }
        }

        let _info_guard = if e2e.cwd.as_str().is_empty() {
            None
        } else {
            let mut case_settings = insta::Settings::clone_current();
            case_settings.set_info(&serde_json::json!({ "cwd": e2e.cwd.as_str() }));
            Some(case_settings.bind_to_scope())
        };

        let e2e_stage_path = tmpdir.join(vite_str::format!("{fixture_name}_e2e_stage_{e2e_count}"));
        e2e_count += 1;
        CopyOptions::new().copy_tree(fixture_path, e2e_stage_path.as_path()).unwrap();

        let e2e_stage_path_str = e2e_stage_path.as_path().to_str().unwrap();

        let mut e2e_outputs = String::new();
        for step in &e2e.steps {
            let step_command = step.command();
            let mut cmd = CommandBuilder::new(&shell_exe);
            cmd.arg("-c");
            cmd.arg(step_command);
            cmd.env_clear();
            cmd.env("PATH", &e2e_env_path);
            cmd.env("NO_COLOR", "1");
            cmd.env("TERM", "dumb");
            cmd.cwd(e2e_stage_path.join(&e2e.cwd).as_path());

            // On Windows, inherit PATHEXT for executable lookup
            if cfg!(windows)
                && let Ok(pathext) = std::env::var("PATHEXT")
            {
                cmd.env("PATHEXT", pathext);
            }

            let terminal = TestTerminal::spawn(SCREEN_SIZE, cmd).unwrap();
            let mut killer = terminal.child_handle.clone();
            let interactions = step.interactions().to_vec();
            let output = Arc::new(Mutex::new(String::new()));
            let output_for_thread = Arc::clone(&output);
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let mut terminal = terminal;

                for interaction in interactions {
                    match interaction {
                        Interaction::ExpectMilestone(expect) => {
                            output_for_thread.lock().unwrap().push_str(
                                vite_str::format!(
                                    "@ expect-milestone: {}\n",
                                    expect.expect_milestone
                                )
                                .as_str(),
                            );
                            let milestone_screen =
                                terminal.reader.expect_milestone(expect.expect_milestone.as_str());
                            let mut output = output_for_thread.lock().unwrap();
                            output.push_str(&milestone_screen);
                            output.push('\n');
                        }
                        Interaction::Write(write) => {
                            output_for_thread
                                .lock()
                                .unwrap()
                                .push_str(vite_str::format!("@ write: {}\n", write.write).as_str());
                            terminal.writer.write_all(write.write.as_str().as_bytes()).unwrap();
                            terminal.writer.flush().unwrap();
                        }
                        Interaction::WriteLine(write_line) => {
                            output_for_thread.lock().unwrap().push_str(
                                vite_str::format!("@ write-line: {}\n", write_line.write_line)
                                    .as_str(),
                            );
                            terminal
                                .writer
                                .write_line(write_line.write_line.as_str().as_bytes())
                                .unwrap();
                        }
                        Interaction::WriteKey(write_key) => {
                            let key_name = write_key.write_key.as_str();
                            output_for_thread
                                .lock()
                                .unwrap()
                                .push_str(vite_str::format!("@ write-key: {key_name}\n").as_str());
                            terminal.writer.write_all(write_key.write_key.bytes()).unwrap();
                            terminal.writer.flush().unwrap();
                        }
                    }
                }

                let status = terminal.reader.wait_for_exit().unwrap();
                let screen = terminal.reader.screen_contents();

                {
                    let mut output = output_for_thread.lock().unwrap();
                    if !output.is_empty() && !output.ends_with('\n') {
                        output.push('\n');
                    }
                    output.push_str(&screen);
                }

                let _ = tx.send(i64::from(status.exit_code()));
            });

            let (termination_state, output) = match rx.recv_timeout(STEP_TIMEOUT) {
                Ok(exit_code) => {
                    let output = output.lock().unwrap().clone();
                    (TerminationState::Exited(exit_code), output)
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let _ = killer.kill();
                    let output = output.lock().unwrap().clone();
                    (TerminationState::TimedOut, output)
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    panic!("Terminal thread panicked");
                }
            };

            // Format output
            match &termination_state {
                TerminationState::TimedOut => {
                    e2e_outputs.push_str("[timeout]");
                }
                TerminationState::Exited(exit_code) => {
                    if *exit_code != 0 {
                        e2e_outputs.push_str(vite_str::format!("[{exit_code}]").as_str());
                    }
                }
            }

            e2e_outputs.push_str("> ");
            e2e_outputs.push_str(step_command);
            e2e_outputs.push('\n');

            e2e_outputs.push_str(&redact_e2e_output(output, e2e_stage_path_str));
            e2e_outputs.push('\n');

            // Skip remaining steps if timed out
            if matches!(termination_state, TerminationState::TimedOut) {
                break;
            }
        }
        #[expect(
            clippy::disallowed_macros,
            reason = "insta::assert_snapshot! internally uses std::format!"
        )]
        {
            insta::assert_snapshot!(e2e.name.as_str(), e2e_outputs);
        }
    }
}

fn main() {
    // SAFETY: Called before any threads are spawned; insta reads this lazily on first assertion.
    unsafe { std::env::set_var("INSTA_REQUIRE_FULL_MATCH", "1") };

    let filter = std::env::args().nth(1);

    let tmp_dir = tempfile::tempdir().unwrap();
    let tmp_dir_path = AbsolutePathBuf::new(tmp_dir.path().canonicalize().unwrap()).unwrap();

    #[expect(
        clippy::disallowed_types,
        reason = "Path required for CARGO_MANIFEST_DIR path traversal"
    )]
    let fixtures_dir = {
        let manifest_dir =
            std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());

        // Copy .node-version to the tmp dir so version manager shims can resolve the correct
        // Node.js binary when running task commands.
        let repo_root = manifest_dir.join("../..").canonicalize().unwrap();
        std::fs::copy(repo_root.join(".node-version"), tmp_dir.path().join(".node-version"))
            .unwrap();

        manifest_dir.join("tests/e2e_snapshots/fixtures")
    };

    let mut fixture_paths = std::fs::read_dir(fixtures_dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    fixture_paths.sort();

    for case_path in &fixture_paths {
        run_case(&tmp_dir_path, case_path, filter.as_deref());
    }
    #[expect(clippy::print_stdout, reason = "test summary")]
    {
        println!("All cases passed.");
    }
}
