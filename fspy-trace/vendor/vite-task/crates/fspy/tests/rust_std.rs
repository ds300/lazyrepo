mod test_utils;

use std::{
    env::current_dir,
    fs::{File, OpenOptions},
    process::Stdio,
};

use fspy::AccessMode;
use test_log::test;
use test_utils::assert_contains;

#[test(tokio::test)]
async fn open_read() -> anyhow::Result<()> {
    let accesses = track_fn!((), |(): ()| {
        let _ = File::open("hello");
    })
    .await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);

    Ok(())
}

#[test(tokio::test)]
async fn open_write() -> anyhow::Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let tmp_path = tmp_dir.path().join("hello");
    let tmp_path_str = tmp_path.to_str().unwrap().to_owned();
    let accesses = track_fn!(tmp_path_str, |tmp_path_str: String| {
        let _ = OpenOptions::new().write(true).open(tmp_path_str);
    })
    .await?;
    assert_contains(&accesses, tmp_path.as_path(), AccessMode::WRITE);

    Ok(())
}

#[test(tokio::test)]
async fn readdir() -> anyhow::Result<()> {
    let tmpdir = tempfile::tempdir()?;
    let tmpdir_path = std::fs::canonicalize(tmpdir.path())?;
    // Reading a non-existent directory results in different tracked accesses on different platforms:
    // - Windows: READ, because the NT APIs open the directory as handle just like files (NtCreateFile/NtOpenFile),
    //   and if that fails, not read dir call (NtQueryDirectoryFile/NtQueryDirectoryFileEx) is made.
    // - macOS/Linux:
    //   - opendir results in a read_dir access. This call is directly made without trying to open the directory as a fd first.
    //   - open + fopendir results in READ access, because open would fail with ENOENT, and fopendir is not called.
    //
    // This difference is acceptable because both will result in a "not found" fingerprint in vite-task.
    // To keep the test consistent across platforms, we create the directory first.
    std::fs::create_dir(tmpdir.path().join("hello_dir"))?;

    let accesses = track_fn!(tmpdir_path.to_str().unwrap().to_owned(), |tmpdir_path: String| {
        std::env::set_current_dir(tmpdir_path).unwrap();
        // Consume at least one entry so that getdents64 fires on seccomp targets.
        let _ = std::fs::read_dir("hello_dir").unwrap().next();
    })
    .await?;
    assert_contains(&accesses, tmpdir_path.join("hello_dir").as_path(), AccessMode::READ_DIR);

    Ok(())
}

#[test(tokio::test)]
async fn read_in_subprocess() -> anyhow::Result<()> {
    let accesses = track_fn!((), |(): ()| {
        let mut command = if cfg!(windows) {
            let mut command = std::process::Command::new("cmd");
            command.arg("/c").arg("type hello");
            command
        } else {
            let mut command = std::process::Command::new("/bin/sh");
            command.arg("-c").arg("cat hello");
            command
        };
        command
            .stdout(Stdio::null())
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
            .wait()
            .unwrap();
    })
    .await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);

    Ok(())
}

#[test(tokio::test)]
async fn read_program() -> anyhow::Result<()> {
    let accesses = track_fn!((), |(): ()| {
        let _ = std::process::Command::new("./not_exist.exe").spawn();
    })
    .await?;
    assert_contains(
        &accesses,
        current_dir().unwrap().join("not_exist.exe").as_path(),
        AccessMode::READ,
    );

    Ok(())
}
