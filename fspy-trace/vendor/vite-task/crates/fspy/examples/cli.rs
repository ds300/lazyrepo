use std::{env::args_os, ffi::OsStr, path::PathBuf, pin::Pin};

use tokio::{
    fs::File,
    io::{AsyncWrite, stdout},
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = args_os();
    let _ = args.next();
    assert_eq!(args.next().as_deref(), Some(OsStr::new("-o")));

    let out_path = args.next().unwrap();

    let program = PathBuf::from(args.next().unwrap());

    let mut command = fspy::Command::new(program);
    command.envs(std::env::vars_os()).args(args);

    let child = command.spawn().await?;
    let termination = child.wait_handle.await?;

    let mut path_count = 0usize;
    let out_file: Pin<Box<dyn AsyncWrite>> =
        if out_path == "-" { Box::pin(stdout()) } else { Box::pin(File::create(out_path).await?) };

    let mut csv_writer = csv_async::AsyncWriter::from_writer(out_file);

    for acc in termination.path_accesses.iter() {
        path_count += 1;
        let path_str = format!("{:?}", acc.path);
        let mode_str = format!("{:?}", acc.mode);
        csv_writer.write_record(&[path_str.as_bytes(), mode_str.as_bytes()]).await?;
    }
    csv_writer.flush().await?;

    #[expect(
        clippy::print_stderr,
        reason = "CLI example: stderr output is intentional for user feedback"
    )]
    {
        eprintln!("\nfspy: {path_count} paths accessed. status: {}", termination.status);
    }
    Ok(())
}
