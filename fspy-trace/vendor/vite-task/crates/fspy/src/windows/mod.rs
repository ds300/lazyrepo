use std::{
    ffi::{CStr, c_char},
    io,
    os::windows::{ffi::OsStrExt, io::AsRawHandle, process::ChildExt as _},
    path::Path,
    sync::Arc,
};

use const_format::formatcp;
use fspy_detours_sys::{DetourCopyPayloadToProcess, DetourUpdateProcessWithDll};
use fspy_shared::{
    ipc::{BINCODE_CONFIG, PathAccess, channel::channel},
    windows::{PAYLOAD_ID, Payload},
};
use futures_util::FutureExt;
use winapi::{
    shared::minwindef::TRUE,
    um::{processthreadsapi::ResumeThread, winbase::CREATE_SUSPENDED},
};
use winsafe::co::{CP, WC};
use xxhash_rust::const_xxh3::xxh3_128;

use crate::{
    ChildTermination, TrackedChild,
    artifact::Artifact,
    command::Command,
    error::SpawnError,
    ipc::{OwnedReceiverLockGuard, SHM_CAPACITY},
};

const PRELOAD_CDYLIB_BINARY: &[u8] = include_bytes!(env!("CARGO_CDYLIB_FILE_FSPY_PRELOAD_WINDOWS"));
const INTERPOSE_CDYLIB: Artifact = Artifact::new(
    "fsyp_preload",
    PRELOAD_CDYLIB_BINARY,
    formatcp!("{:x}", xxh3_128(PRELOAD_CDYLIB_BINARY)),
);

pub struct PathAccessIterable {
    ipc_receiver_lock_guard: OwnedReceiverLockGuard,
}

impl PathAccessIterable {
    pub fn iter(&self) -> impl Iterator<Item = PathAccess<'_>> {
        self.ipc_receiver_lock_guard.iter_path_accesses()
    }
}

// pub struct TracedProcess {
//     pub child: Child,
//     pub path_access_stream: PathAccessIter,
// }

#[derive(Debug, Clone)]
pub struct SpyImpl {
    ansi_dll_path_with_nul: Arc<CStr>,
}

impl SpyImpl {
    pub fn init_in(path: &Path) -> io::Result<Self> {
        let dll_path = INTERPOSE_CDYLIB.write_to(path, ".dll").unwrap();

        let wide_dll_path = dll_path.as_os_str().encode_wide().collect::<Vec<u16>>();
        let mut ansi_dll_path =
            winsafe::WideCharToMultiByte(CP::ACP, WC::NoValue, &wide_dll_path, None, None)
                .map_err(|err| io::Error::from_raw_os_error(err.raw().cast_signed()))?;

        ansi_dll_path.push(0);

        // SAFETY: we just pushed a NUL byte, so the slice is NUL-terminated
        let ansi_dll_path_with_nul =
            unsafe { CStr::from_bytes_with_nul_unchecked(ansi_dll_path.as_slice()) };
        Ok(Self { ansi_dll_path_with_nul: ansi_dll_path_with_nul.into() })
    }

    #[expect(clippy::unused_async, reason = "async signature required by SpyImpl trait")]
    pub(crate) async fn spawn(&self, mut command: Command) -> Result<TrackedChild, SpawnError> {
        let ansi_dll_path_with_nul = Arc::clone(&self.ansi_dll_path_with_nul);
        command.env("FSPY", "1");
        let mut command = command.into_tokio_command();

        command.creation_flags(CREATE_SUSPENDED);

        let (channel_conf, receiver) =
            channel(SHM_CAPACITY).map_err(SpawnError::ChannelCreation)?;

        let mut spawn_success = false;
        let spawn_success = &mut spawn_success;
        let mut child = command
            .spawn_with(|std_command| {
                let std_child = std_command.spawn()?;
                *spawn_success = true;

                let mut dll_paths = ansi_dll_path_with_nul.as_ptr().cast::<c_char>();
                let process_handle = std_child.as_raw_handle().cast::<winapi::ctypes::c_void>();
                // SAFETY: process_handle is a valid handle to the just-spawned child process,
                // dll_paths points to a valid null-terminated ANSI string
                let success =
                    unsafe { DetourUpdateProcessWithDll(process_handle, &raw mut dll_paths, 1) };
                if success != TRUE {
                    return Err(io::Error::last_os_error());
                }

                let payload = Payload {
                    channel_conf: channel_conf.clone(),
                    ansi_dll_path_with_nul: ansi_dll_path_with_nul.to_bytes(),
                };
                let payload_bytes = bincode::encode_to_vec(payload, BINCODE_CONFIG).unwrap();
                // SAFETY: process_handle is valid, PAYLOAD_ID is a static GUID,
                // payload_bytes is a valid buffer with correct length
                let success = unsafe {
                    DetourCopyPayloadToProcess(
                        process_handle,
                        &PAYLOAD_ID,
                        payload_bytes.as_ptr().cast(),
                        payload_bytes.len().try_into().unwrap(),
                    )
                };
                if success != TRUE {
                    return Err(io::Error::last_os_error());
                }

                let main_thread_handle = std_child.main_thread_handle();
                // SAFETY: main_thread_handle is a valid thread handle from the spawned child
                let resume_thread_ret =
                    unsafe { ResumeThread(main_thread_handle.as_raw_handle().cast()) }
                        .cast_signed();

                if resume_thread_ret == -1 {
                    return Err(io::Error::last_os_error());
                }

                Ok(std_child)
            })
            .map_err(|err| {
                if *spawn_success { SpawnError::OsSpawn(err) } else { SpawnError::Injection(err) }
            })?;

        Ok(TrackedChild {
            stdin: child.stdin.take(),
            stdout: child.stdout.take(),
            stderr: child.stderr.take(),
            // Keep polling for the child to exit in the background even if `wait_handle` is not awaited,
            // because we need to stop the supervisor and lock the channel as soon as the child exits.
            wait_handle: tokio::spawn(async move {
                let status = child.wait().await?;
                // Lock the ipc channel after the child has exited.
                // We are not interested in path accesses from descendants after the main child has exited.
                let ipc_receiver_lock_guard = OwnedReceiverLockGuard::lock_async(receiver).await?;
                let path_accesses = PathAccessIterable { ipc_receiver_lock_guard };

                io::Result::Ok(ChildTermination { status, path_accesses })
            })
            .map(|f| f?) // flatten JoinError and io::Result
            .boxed(),
        })
    }
}
