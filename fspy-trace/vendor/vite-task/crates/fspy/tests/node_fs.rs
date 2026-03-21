mod test_utils;

use std::{
    env::{current_dir, vars_os},
    ffi::OsStr,
};

use fspy::{AccessMode, PathAccessIterable};
use test_log::test;
use test_utils::assert_contains;

async fn track_node_script(script: &str, args: &[&OsStr]) -> anyhow::Result<PathAccessIterable> {
    let mut command = fspy::Command::new("node");
    command
        .arg("-e")
        .envs(vars_os()) // https://github.com/jdx/mise/discussions/5968
        .arg(script)
        .args(args);
    let child = command.spawn().await?;
    let termination = child.wait_handle.await?;
    assert!(termination.status.success());
    Ok(termination.path_accesses)
}

#[test(tokio::test)]
async fn read_sync() -> anyhow::Result<()> {
    let accesses = track_node_script("try { fs.readFileSync('hello') } catch {}", &[]).await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);
    Ok(())
}

#[test(tokio::test)]
async fn exist_sync() -> anyhow::Result<()> {
    let accesses = track_node_script("try { fs.existsSync('hello') } catch {}", &[]).await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);
    Ok(())
}

#[test(tokio::test)]
async fn stat_sync() -> anyhow::Result<()> {
    let accesses = track_node_script("try { fs.statSync('hello') } catch {}", &[]).await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);
    Ok(())
}

#[test(tokio::test)]
async fn create_read_stream() -> anyhow::Result<()> {
    let accesses = track_node_script(
        "try { fs.createReadStream('hello').on('error', () => {}) } catch {}",
        &[],
    )
    .await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);
    Ok(())
}

#[test(tokio::test)]
async fn create_write_stream() -> anyhow::Result<()> {
    let tmpdir = tempfile::tempdir()?;
    let file_path = tmpdir.path().join("hello");
    let accesses = track_node_script(
        "try { fs.createWriteStream(process.argv[1]).on('error', () => {}) } catch {}",
        &[file_path.as_os_str()],
    )
    .await?;
    assert_contains(&accesses, file_path.as_path(), AccessMode::WRITE);
    Ok(())
}

#[test(tokio::test)]
async fn write_sync() -> anyhow::Result<()> {
    let tmpdir = tempfile::tempdir()?;
    let file_path = tmpdir.path().join("hello");
    let accesses = track_node_script(
        "try { fs.writeFileSync(process.argv[1], '') } catch {}",
        &[file_path.as_os_str()],
    )
    .await?;
    assert_contains(&accesses, &file_path, AccessMode::WRITE);
    Ok(())
}

#[test(tokio::test)]
async fn read_dir_sync() -> anyhow::Result<()> {
    let accesses = track_node_script("try { fs.readdirSync('.') } catch {}", &[]).await?;
    assert_contains(&accesses, &current_dir().unwrap(), AccessMode::READ_DIR);
    Ok(())
}

#[test(tokio::test)]
async fn subprocess() -> anyhow::Result<()> {
    let cmd = if cfg!(windows) {
        r"'cmd', ['/c', 'type hello']"
    } else {
        r"'/bin/sh', ['-c', 'cat hello']"
    };
    let accesses = track_node_script(
        &format!("try {{ child_process.spawnSync({cmd}, {{ stdio: 'ignore' }}) }} catch {{}}"),
        &[],
    )
    .await?;
    assert_contains(&accesses, current_dir().unwrap().join("hello").as_path(), AccessMode::READ);
    Ok(())
}
