use std::borrow::Cow;

use cow_utils::CowUtils as _;
use serde::Serialize;
use vite_task_graph::config::DEFAULT_UNTRACKED_ENV;

fn visit_json(value: &mut serde_json::Value, f: &mut impl FnMut(&mut serde_json::Value)) {
    f(value);
    match value {
        serde_json::Value::Array(arr) => {
            for item in arr {
                visit_json(item, f);
            }
        }
        serde_json::Value::Object(map) => {
            for (_key, val) in map {
                visit_json(val, f);
            }
        }
        _ => {}
    }
}

fn redact_string_in_json(value: &mut serde_json::Value, redactions: &[(&str, &str)]) {
    visit_json(value, &mut |v| {
        if let serde_json::Value::String(s) = v {
            redact_string(s, redactions);
        }
    });
}

/// Strip Windows executable extensions (case-insensitive) for cross-platform consistency
#[expect(
    clippy::disallowed_types,
    reason = "String mutation required by serde_json::Value::String which stores a String"
)]
fn strip_windows_executable_extension(s: &mut String) {
    let lower = s.as_str().cow_to_lowercase();
    for ext in [".cmd", ".bat", ".exe", ".com"] {
        if lower.ends_with(ext) {
            s.truncate(s.len() - ext.len());
            break;
        }
    }
}

#[expect(
    clippy::disallowed_types,
    reason = "String mutation required by serde_json::Value::String which stores a String"
)]
fn redact_string(s: &mut String, redactions: &[(&str, &str)]) {
    for (from, to) in redactions {
        if let Cow::Owned(mut replaced) = s.as_str().cow_replace(from, to) {
            if cfg!(windows) {
                // Also replace with backslashes on Windows
                replaced = replaced.cow_replace("\\", "/").into_owned();
            }
            *s = replaced;
        }
    }
}

#[expect(
    clippy::disallowed_types,
    reason = "String required by std::env::var return type and serde_json Value manipulation; Path required for CARGO_MANIFEST_DIR path manipulation"
)]
#[expect(
    clippy::too_many_lines,
    reason = "redaction logic is sequential and reads better in one function"
)]
pub fn redact_snapshot(value: &impl Serialize, workspace_root: &str) -> serde_json::Value {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    // Get the packages/tools directory path
    let tools_dir = std::path::Path::new(&manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("packages")
        .join("tools");
    let tools_dir_str = tools_dir.to_str().unwrap().to_owned();
    let mut json_value = serde_json::to_value(value).unwrap();

    // On Windows, paths might use either backslashes or forward slashes
    // Try both variants for workspace_root, manifest_dir, and tools_dir
    let workspace_root_forward = workspace_root.cow_replace('\\', "/");
    let manifest_dir_forward = manifest_dir.as_str().cow_replace('\\', "/");
    let tools_dir_forward = tools_dir_str.as_str().cow_replace('\\', "/");

    redact_string_in_json(
        &mut json_value,
        &[
            (workspace_root, "<workspace>"),
            (workspace_root_forward.as_ref(), "<workspace>"),
            (manifest_dir.as_str(), "<manifest_dir>"),
            (manifest_dir_forward.as_ref(), "<manifest_dir>"),
            (tools_dir_str.as_str(), "<tools>"),
            (tools_dir_forward.as_ref(), "<tools>"),
        ],
    );

    // Normalize PATH separators for cross-platform consistency (Windows uses ; Unix uses :)
    visit_json(&mut json_value, &mut |v| {
        let serde_json::Value::Object(map) = v else {
            return;
        };
        if let Some(serde_json::Value::String(path)) = map.get_mut("PATH")
            && let Cow::Owned(replaced) = path.as_str().cow_replace(';', ":")
        {
            *path = replaced;
        }
    });

    // Normalize Windows program names and paths by stripping common extensions for cross-platform consistency
    // This must happen BEFORE shell redaction so that "cmd.exe" becomes "cmd" before comparison
    visit_json(&mut json_value, &mut |v| {
        let serde_json::Value::Object(map) = v else {
            return;
        };
        // Normalize program_name field
        if let Some(serde_json::Value::String(program_name)) = map.get_mut("program_name") {
            strip_windows_executable_extension(program_name);
        }
        // Normalize program_path field
        if let Some(serde_json::Value::String(program_path)) = map.get_mut("program_path") {
            strip_windows_executable_extension(program_path);
        }
    });

    // Redact shell program and arguments for cross-platform consistency
    // Note: os_shell_path still includes .exe because we compare against program_path before extension stripping
    let os_shell_path = if cfg!(windows) { "C:\\Windows\\System32\\cmd" } else { "/bin/sh" };
    let os_shell_name = if cfg!(windows) { "cmd" } else { "sh" };
    let os_shell_args: &[&str] = if cfg!(windows) { &["/d", "/s", "/c"] } else { &["-c"] };
    visit_json(&mut json_value, &mut |v| {
        if let serde_json::Value::String(s) = v {
            // Use case-insensitive comparison on Windows since path casing can vary
            let matches_shell_path = if cfg!(windows) {
                s.eq_ignore_ascii_case(os_shell_path)
            } else {
                s == os_shell_path
            };
            if matches_shell_path {
                *s = "<os_shell_path>".to_string();
            } else if s == os_shell_name {
                *s = "<os_shell_name>".to_string();
            }
        } else if let serde_json::Value::Array(array) = v {
            // Check if the beginning of the array matches the shell args
            for (n, arg) in os_shell_args.iter().enumerate() {
                if !matches!(array.get(n), Some(serde_json::Value::String(s)) if s == *arg) {
                    return;
                }
            }
            // Redact the shell args
            array.drain(0..os_shell_args.len());
            array.insert(0, serde_json::Value::String("<os_shell_args>".to_string()));
        }
    });

    visit_json(&mut json_value, &mut |v| {
        let serde_json::Value::Array(array) = v else {
            return;
        };
        let contains_all_default_untracked_env =
            DEFAULT_UNTRACKED_ENV.iter().all(|default_untracked_env| {
                array.iter().any(|item| {
                    if let serde_json::Value::String(s) = item {
                        s == *default_untracked_env
                    } else {
                        false
                    }
                })
            });
        // Remove default untracked envs from snapshots to reduce noise
        if contains_all_default_untracked_env {
            array.retain(|item| {
                if let serde_json::Value::String(s) = item {
                    !DEFAULT_UNTRACKED_ENV.contains(&s.as_str())
                } else {
                    true
                }
            });
            // Sort remaining entries for deterministic snapshots (FxHashSet has non-deterministic order)
            array.sort_by(|a, b| {
                let a_str = if let serde_json::Value::String(s) = a { s.as_str() } else { "" };
                let b_str = if let serde_json::Value::String(s) = b { s.as_str() } else { "" };
                a_str.cmp(b_str)
            });
            array.push(serde_json::Value::String("<default untracked envs>".to_string()));
        }
    });

    json_value
}
