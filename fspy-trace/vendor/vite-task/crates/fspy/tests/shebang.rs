#![cfg(unix)]
mod test_utils;

use std::{
    os::unix::fs::PermissionsExt,
    path::Path,
    process::{Command, Stdio},
};

use fspy::AccessMode;
use test_log::test;
use test_utils::assert_contains;
use tokio::fs;

#[test(tokio::test)]
async fn spawn_sh_shebang() -> anyhow::Result<()> {
    let tmp_dir = tempfile::TempDir::new()?;

    let shebang_script_path = tmp_dir.path().join("fspy_test_shebang_script.sh");
    let shebang_script_path = shebang_script_path.into_os_string().into_string().unwrap();

    fs::write(&shebang_script_path, "#!/bin/sh\ncat hello\n").await?;

    let mut perms = fs::metadata(&shebang_script_path).await?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&shebang_script_path, perms).await?;

    let accesses = track_fn!(shebang_script_path.clone(), |shebang_script_path: String| {
        let _ignored = Command::new(&shebang_script_path)
            .current_dir("/")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .status()
            .expect("Failed to execute shebang script");
    })
    .await?;

    assert_contains(&accesses, Path::new(&shebang_script_path), AccessMode::READ);
    assert_contains(&accesses, Path::new("/hello"), AccessMode::READ);

    Ok(())
}
