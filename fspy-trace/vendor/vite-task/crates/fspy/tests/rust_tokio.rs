mod test_utils;

use std::{env::current_dir, process::Stdio};

use fspy::AccessMode;
use test_log::test;
use test_utils::assert_contains;
use tokio::fs::OpenOptions;

#[test(tokio::test)]
async fn open_read() -> anyhow::Result<()> {
    let accesses = track_fn!((), |(): ()| {
        tokio::runtime::Builder::new_current_thread().enable_io().build().unwrap().block_on(
            async {
                let _ = tokio::fs::File::open("hello").await;
            },
        );
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
        tokio::runtime::Builder::new_current_thread().enable_io().build().unwrap().block_on(
            async {
                let _ = OpenOptions::new().write(true).open(tmp_path_str).await;
            },
        );
    })
    .await?;
    assert_contains(&accesses, tmp_path.as_path(), AccessMode::WRITE);

    Ok(())
}

#[test(tokio::test)]
async fn readdir() -> anyhow::Result<()> {
    let tmpdir = tempfile::tempdir()?;
    let tmpdir_path = std::fs::canonicalize(tmpdir.path())?;

    std::fs::create_dir(tmpdir.path().join("hello_dir"))?;

    let accesses = track_fn!(tmpdir_path.to_str().unwrap().to_owned(), |tmpdir_path: String| {
        std::env::set_current_dir(tmpdir_path).unwrap();
        tokio::runtime::Builder::new_current_thread().enable_io().build().unwrap().block_on(
            async {
                let _ = tokio::fs::read_dir("hello_dir").await;
            },
        );
    })
    .await?;
    assert_contains(&accesses, tmpdir_path.join("hello_dir").as_path(), AccessMode::READ_DIR);

    Ok(())
}

#[test(tokio::test)]
async fn subprocess() -> anyhow::Result<()> {
    let accesses = track_fn!((), |(): ()| {
        tokio::runtime::Builder::new_current_thread().enable_io().build().unwrap().block_on(
            async {
                let mut command = if cfg!(windows) {
                    let mut command = tokio::process::Command::new("cmd");
                    command.arg("/c").arg("type hello");
                    command
                } else {
                    let mut command = tokio::process::Command::new("/bin/sh");
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
                    .await
                    .unwrap();
            },
        );
    })
    .await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);

    Ok(())
}
