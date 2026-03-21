#[cfg(target_os = "linux")]
mod syscall_handler;

#[cfg(target_os = "macos")]
mod macos_artifacts;

use std::{io, path::Path};

#[cfg(target_os = "linux")]
use fspy_seccomp_unotify::supervisor::supervise;
#[cfg(not(target_env = "musl"))]
use fspy_shared::ipc::NativeStr;
use fspy_shared::ipc::{PathAccess, channel::channel};
#[cfg(target_os = "macos")]
use fspy_shared_unix::payload::Artifacts;
use fspy_shared_unix::{
    exec::ExecResolveConfig,
    payload::{Payload, encode_payload},
    spawn::handle_exec,
};
use futures_util::FutureExt;
#[cfg(target_os = "linux")]
use syscall_handler::SyscallHandler;
use tokio::task::spawn_blocking;

use crate::{
    ChildTermination, Command, TrackedChild,
    arena::PathAccessArena,
    error::SpawnError,
    ipc::{OwnedReceiverLockGuard, SHM_CAPACITY},
};

#[derive(Debug)]
pub struct SpyImpl {
    #[cfg(target_os = "macos")]
    artifacts: Artifacts,

    #[cfg(not(target_env = "musl"))]
    preload_path: Box<NativeStr>,
}

#[cfg(not(target_env = "musl"))]
const PRELOAD_CDYLIB_BINARY: &[u8] = include_bytes!(env!("CARGO_CDYLIB_FILE_FSPY_PRELOAD_UNIX"));

impl SpyImpl {
    /// Initialize the fs access spy by writing the preload library on disk.
    ///
    /// On musl targets, we don't build a preload library —
    /// only seccomp-based tracking is used.
    pub fn init_in(#[cfg_attr(target_env = "musl", allow(unused))] dir: &Path) -> io::Result<Self> {
        #[cfg(not(target_env = "musl"))]
        let preload_path = {
            use const_format::formatcp;
            use xxhash_rust::const_xxh3::xxh3_128;

            use crate::artifact::Artifact;

            const PRELOAD_CDYLIB: Artifact = Artifact {
                name: "fspy_preload",
                content: PRELOAD_CDYLIB_BINARY,
                hash: formatcp!("{:x}", xxh3_128(PRELOAD_CDYLIB_BINARY)),
            };

            let preload_cdylib_path = PRELOAD_CDYLIB.write_to(dir, ".dylib")?;
            preload_cdylib_path.as_path().into()
        };

        Ok(Self {
            #[cfg(not(target_env = "musl"))]
            preload_path,
            #[cfg(target_os = "macos")]
            artifacts: {
                let coreutils_path = macos_artifacts::COREUTILS_BINARY.write_to(dir, "")?;
                let bash_path = macos_artifacts::OILS_BINARY.write_to(dir, "")?;
                Artifacts {
                    bash_path: bash_path.as_path().into(),
                    coreutils_path: coreutils_path.as_path().into(),
                }
            },
        })
    }

    pub(crate) async fn spawn(&self, mut command: Command) -> Result<TrackedChild, SpawnError> {
        #[cfg(target_os = "linux")]
        let supervisor = supervise::<SyscallHandler>().map_err(SpawnError::Supervisor)?;

        let (ipc_channel_conf, ipc_receiver) =
            channel(SHM_CAPACITY).map_err(SpawnError::ChannelCreation)?;

        let payload = Payload {
            ipc_channel_conf,

            #[cfg(target_os = "macos")]
            artifacts: self.artifacts.clone(),

            #[cfg(not(target_env = "musl"))]
            preload_path: self.preload_path.clone(),

            #[cfg(target_os = "linux")]
            seccomp_payload: supervisor.payload().clone(),
        };

        let encoded_payload = encode_payload(payload);

        let mut exec = command.get_exec();
        let mut exec_resolve_accesses = PathAccessArena::default();
        let pre_exec = handle_exec(
            &mut exec,
            ExecResolveConfig::search_path_enabled(None),
            &encoded_payload,
            |mode, path| {
                exec_resolve_accesses.add(PathAccess { mode, path: path.into() });
            },
        )
        .map_err(|err| SpawnError::Injection(err.into()))?;
        command.set_exec(exec);
        command.env("FSPY", "1");

        let mut tokio_command = command.into_tokio_command();

        // SAFETY: the pre_exec closure only calls pre_exec.run() which is safe to call in a fork context
        unsafe {
            tokio_command.pre_exec(move || {
                if let Some(pre_exec) = pre_exec.as_ref() {
                    pre_exec.run()?;
                }
                Ok(())
            });
        }

        // tokio_command.spawn blocks while executing the `pre_exec` closure.
        // Run it inside spawn_blocking to avoid blocking the tokio runtime, especially the supervisor loop,
        // which needs to accept incoming connections while `pre_exec` is connecting to it.
        let mut child = spawn_blocking(move || tokio_command.spawn())
            .await
            .map_err(|err| SpawnError::OsSpawn(err.into()))?
            .map_err(SpawnError::OsSpawn)?;

        Ok(TrackedChild {
            stdin: child.stdin.take(),
            stdout: child.stdout.take(),
            stderr: child.stderr.take(),
            // Keep polling for the child to exit in the background even if `wait_handle` is not awaited,
            // because we need to stop the supervisor and lock the channel as soon as the child exits.
            wait_handle: tokio::spawn(async move {
                let status = child.wait().await?;

                let arenas = std::iter::once(exec_resolve_accesses);
                // Stop the supervisor and collect path accesses from it.
                #[cfg(target_os = "linux")]
                let arenas = arenas.chain(
                    supervisor
                        .stop()
                        .await?
                        .into_iter()
                        .map(syscall_handler::SyscallHandler::into_arena),
                );
                let arenas = arenas.collect::<Vec<_>>();

                // Lock the ipc channel after the child has exited.
                // We are not interested in path accesses from descendants after the main child has exited.
                let ipc_receiver_lock_guard =
                    OwnedReceiverLockGuard::lock_async(ipc_receiver).await?;
                let path_accesses = PathAccessIterable { arenas, ipc_receiver_lock_guard };

                io::Result::Ok(ChildTermination { status, path_accesses })
            })
            .map(|f| f?) // flatten JoinError and io::Result
            .boxed(),
        })
    }
}

pub struct PathAccessIterable {
    arenas: Vec<PathAccessArena>,
    ipc_receiver_lock_guard: OwnedReceiverLockGuard,
}

impl PathAccessIterable {
    pub fn iter(&self) -> impl Iterator<Item = PathAccess<'_>> {
        let accesses_in_arena =
            self.arenas.iter().flat_map(|arena| arena.borrow_accesses().iter()).copied();

        let accesses_in_shm = self.ipc_receiver_lock_guard.iter_path_accesses();
        accesses_in_shm.chain(accesses_in_arena)
    }
}
