use std::{
    collections::{BTreeMap, btree_map::Entry},
    env::{self, args},
    fs::{File, read},
    io::{BufWriter, Write as _, stderr},
    path::PathBuf,
    process::{self, Stdio},
};

use fspy::{AccessMode, PathAccess};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;

#[derive(Serialize, Deserialize)]
struct Config {
    cases: FxHashMap<String, Case>,
}

#[derive(Serialize, Deserialize)]
struct Case {
    dir: String,
    cmd: Vec<String>,
}

struct AccessCollector {
    dir: PathBuf,
    accesses: BTreeMap<String, AccessMode>,
}

impl AccessCollector {
    pub const fn new(dir: PathBuf) -> Self {
        Self { dir, accesses: BTreeMap::new() }
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, AccessMode)> {
        self.accesses.iter().map(|(k, v)| (k.as_str(), *v))
    }

    pub fn add(&mut self, access: PathAccess) {
        let Some(relative_path) = access.path.strip_path_prefix(&self.dir, |result| {
            result.ok().and_then(|p| p.to_str().map(str::to_owned))
        }) else {
            return;
        };
        match self.accesses.entry(relative_path) {
            Entry::Vacant(vacant) => {
                vacant.insert(access.mode);
            }
            Entry::Occupied(mut occupied) => {
                let occupied_mode = occupied.get_mut();
                occupied_mode.insert(access.mode);
            }
        }
    }
}

#[tokio::main]
#[expect(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "CLI tool that outputs results and errors to stdout/stderr"
)]
async fn main() {
    let mut args = args();
    args.next(); // skip the first argument (the program name)
    let filter = args.next();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config = read(manifest_dir.join("e2e_config.toml")).unwrap();
    let config: Config = toml::from_slice(&config).unwrap();
    for (name, case) in config.cases {
        if let Some(filter) = &filter
            && !name.contains(filter)
        {
            continue;
        }
        println!("Running case `{}` in dir `{}`", name, case.dir);
        let mut cmd = fspy::Command::new(case.cmd[0].clone());
        let dir = manifest_dir.join(&case.dir);
        cmd.args(&case.cmd[1..])
            .envs(env::vars_os())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&dir);

        let mut tracked_child = cmd.spawn().await.unwrap();

        let mut stdout_bytes = Vec::<u8>::new();
        tracked_child.stdout.take().unwrap().read_to_end(&mut stdout_bytes).await.unwrap();

        let mut stderr_bytes = Vec::<u8>::new();
        tracked_child.stderr.take().unwrap().read_to_end(&mut stderr_bytes).await.unwrap();

        let termination = tracked_child.wait_handle.await.unwrap();

        if !termination.status.success() {
            eprintln!("----- stdout begin -----");
            stderr().write_all(&stdout_bytes).unwrap();
            eprintln!("----- stdout end -----");
            eprintln!("----- stderr begin-----");
            stderr().write_all(&stderr_bytes).unwrap();
            eprintln!("----- stderr end -----");

            eprintln!("Case `{}` failed with status: {}", name, termination.status);
            process::exit(1);
        }

        let mut collector = AccessCollector::new(dir);
        for access in termination.path_accesses.iter() {
            collector.add(access);
        }
        let snap_file = File::create(manifest_dir.join(format!("snaps/{name}.txt"))).unwrap();
        let mut snap_writer = BufWriter::new(snap_file);
        for (path, mode) in collector.iter() {
            writeln!(snap_writer, "{path}: {mode:?}").unwrap();
        }
    }
}
