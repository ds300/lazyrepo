mod test_utils;

use std::{env::vars_os, ffi::OsString};

use fspy::{AccessMode, PathAccessIterable};
use test_log::test;

/// Get the packages/tools/.bin directory path
fn tools_bin_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("packages")
        .join("tools")
        .join("node_modules")
        .join(".bin")
}

/// Find the oxlint executable in packages/tools
fn find_oxlint() -> std::path::PathBuf {
    let tools_dir = tools_bin_dir();
    which::which_in("oxlint", Some(&tools_dir), std::env::current_dir().unwrap())
        .expect("oxlint not found in packages/tools/node_modules/.bin")
}

async fn track_oxlint(dir: &std::path::Path, args: &[&str]) -> anyhow::Result<PathAccessIterable> {
    let oxlint_path = find_oxlint();
    let mut command = fspy::Command::new(&oxlint_path);

    // Build PATH with packages/tools/.bin prepended so oxlint can find tsgolint
    let tools_dir = tools_bin_dir();
    let new_path = if let Some(existing_path) = std::env::var_os("PATH") {
        let mut paths = vec![tools_dir.as_os_str().to_owned()];
        paths.extend(std::env::split_paths(&existing_path).map(std::path::PathBuf::into_os_string));
        std::env::join_paths(paths)?
    } else {
        OsString::from(&tools_dir)
    };

    command
        .args(args)
        .envs(vars_os().filter(|(k, _)| !k.eq_ignore_ascii_case("PATH")))
        .env("PATH", new_path)
        .current_dir(dir);

    let child = command.spawn().await?;
    let termination = child.wait_handle.await?;
    // oxlint may return non-zero if it finds lint errors, that's OK
    Ok(termination.path_accesses)
}

#[test(tokio::test)]
async fn oxlint_reads_js_file() -> anyhow::Result<()> {
    let tmpdir = tempfile::tempdir()?;
    // on macOS, tmpdir.path() may be a symlink, so we need to canonicalize it
    let tmpdir_path = std::fs::canonicalize(tmpdir.path())?;

    let js_file = tmpdir_path.join("test.js");
    std::fs::write(&js_file, "console.log('hello');")?;

    let accesses = track_oxlint(&tmpdir_path, &[]).await?;

    // Check that oxlint read the JS file
    test_utils::assert_contains(&accesses, &js_file, AccessMode::READ);

    Ok(())
}

#[test(tokio::test)]
async fn oxlint_reads_directory() -> anyhow::Result<()> {
    let tmpdir = tempfile::tempdir()?;

    // on macOS, tmpdir.path() may be a symlink, so we need to canonicalize it
    let tmpdir_path = std::fs::canonicalize(tmpdir.path())?;

    let accesses = track_oxlint(&tmpdir_path, &[]).await?;

    // Check that oxlint read the directory to find JS files
    // This is the key check - if READ_DIR is not tracked, cache won't detect new files
    test_utils::assert_contains(&accesses, &tmpdir_path, AccessMode::READ_DIR);
    Ok(())
}

#[test(tokio::test)]
async fn oxlint_type_aware() -> anyhow::Result<()> {
    let tmpdir = tempfile::tempdir()?;
    // on macOS, tmpdir.path() may be a symlink, so we need to canonicalize it
    let tmpdir_path = std::fs::canonicalize(tmpdir.path())?;

    // Create a simple TypeScript file
    let ts_file = tmpdir_path.join("index.ts");
    std::fs::write(
        &ts_file,
        r"
import type { Foo } from './types';
declare const _foo: Foo;
",
    )?;

    // Run oxlint without --type-aware first
    let accesses = track_oxlint(&tmpdir_path, &[""]).await?;
    let access_to_types_ts = accesses.iter().find(|access| {
        access
            .path
            .strip_path_prefix(&tmpdir_path, |result| result.is_ok_and(|p| p.ends_with("types.ts")))
    });
    assert_eq!(access_to_types_ts, None, "oxlint should not read types.ts without --type-aware");

    // Run oxlint with --type-aware to enable type-aware linting
    let accesses = track_oxlint(&tmpdir_path, &["--type-aware"]).await?;

    // Check that oxlint read types.ts
    test_utils::assert_contains(&accesses, &tmpdir_path.join("types.ts"), AccessMode::READ);

    Ok(())
}
