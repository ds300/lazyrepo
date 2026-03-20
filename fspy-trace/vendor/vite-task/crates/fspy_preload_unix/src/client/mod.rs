pub mod convert;
pub mod raw_exec;

use std::{
    ffi::OsStr, fmt::Debug, num::NonZeroUsize, os::unix::ffi::OsStrExt as _, path::Path,
    sync::OnceLock,
};

use bincode::{enc::write::SizeWriter, encode_into_slice, encode_into_writer};
use convert::{ToAbsolutePath, ToAccessMode};
use fspy_shared::ipc::{BINCODE_CONFIG, PathAccess, channel::Sender};
use fspy_shared_unix::{
    exec::ExecResolveConfig,
    payload::EncodedPayload,
    spawn::{PreExec, handle_exec},
};
use raw_exec::RawExec;

pub struct Client {
    encoded_payload: EncodedPayload,
    ipc_sender: Option<Sender>,
}

// SAFETY: Client fields are only mutated during initialization in the ctor; after that, all access is read-only
#[cfg(target_os = "macos")]
unsafe impl Sync for Client {}
// SAFETY: Client is only sent once during initialization; after that it lives in a static OnceLock
#[cfg(target_os = "macos")]
unsafe impl Send for Client {}

impl Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client").finish()
    }
}

impl Client {
    #[expect(
        clippy::print_stderr,
        reason = "preload library intentionally uses stderr for error reporting"
    )]
    #[cfg(not(test))]
    fn from_env() -> Self {
        use fspy_shared_unix::payload::decode_payload_from_env;

        let encoded_payload = decode_payload_from_env().unwrap();

        let ipc_sender = match encoded_payload.payload.ipc_channel_conf.sender() {
            Ok(sender) => Some(sender),
            Err(err) => {
                // this can happen if the process is started after the root target process has exited.
                // By that time the channel would have been closed in the receiver side.
                // In this case we just leave a message and skip sending any path accesses.
                eprintln!("fspy: failed to create ipc sender: {err}");
                None
            }
        };

        Self { encoded_payload, ipc_sender }
    }

    fn send(&self, mode: fspy_shared::ipc::AccessMode, path: &Path) -> anyhow::Result<()> {
        let Some(ipc_sender) = &self.ipc_sender else {
            // ipc channel not available, skip sending
            return Ok(());
        };
        let path_bytes = path.as_os_str().as_bytes();
        if path_bytes.starts_with(b"/dev/")
            || (cfg!(target_os = "linux")
                && (path_bytes.starts_with(b"/proc/") || path_bytes.starts_with(b"/sys/")))
        {
            return Ok(());
        }
        let path_access = PathAccess { mode, path: path.into() };
        let mut size_writer = SizeWriter::default();
        encode_into_writer(path_access, &mut size_writer, BINCODE_CONFIG)?;

        let frame_size = NonZeroUsize::new(size_writer.bytes_written)
            .expect("fspy: encoded PathAccess should never be empty");

        let mut frame = ipc_sender
            .claim_frame(frame_size)
            .expect("fspy: failed to claim frame in shared memory");
        let written_size = encode_into_slice(path_access, &mut frame, BINCODE_CONFIG)?;
        assert_eq!(written_size, size_writer.bytes_written);

        Ok(())
    }

    pub unsafe fn handle_exec<R>(
        &self,
        config: ExecResolveConfig,
        raw_exec: RawExec,
        f: impl FnOnce(RawExec, Option<PreExec>) -> nix::Result<R>,
    ) -> nix::Result<R> {
        // SAFETY: raw_exec contains valid pointers to C strings and null-terminated arrays, as provided by the caller
        let mut exec = unsafe { raw_exec.to_exec() };
        let pre_exec = handle_exec(&mut exec, config, &self.encoded_payload, |mode, path| {
            self.send(mode, path).unwrap();
        })?;
        RawExec::from_exec(exec, |raw_command| f(raw_command, pre_exec))
    }

    pub unsafe fn try_handle_open(
        &self,
        path: impl ToAbsolutePath,
        mode: impl ToAccessMode,
    ) -> anyhow::Result<()> {
        // SAFETY: mode contains a valid pointer (if ModeStr) or a plain value, as provided by the caller
        let mode = unsafe { mode.to_access_mode() };
        // SAFETY: path contains valid pointers to C strings/file descriptors, as provided by the caller
        let () = unsafe {
            path.to_absolute_path(|abs_path| {
                let Some(abs_path) = abs_path else {
                    return Ok(Ok(()));
                };
                Ok(self.send(mode, Path::new(OsStr::from_bytes(abs_path))))
            })
        }??;

        Ok(())
    }
}

static CLIENT: OnceLock<Client> = OnceLock::new();

pub fn global_client() -> Option<&'static Client> {
    CLIENT.get()
}

pub unsafe fn handle_open(path: impl ToAbsolutePath, mode: impl ToAccessMode) {
    if let Some(client) = global_client() {
        // SAFETY: path and mode contain valid pointers/values forwarded from the interposed function's caller
        unsafe { client.try_handle_open(path, mode) }.unwrap();
    }
}

#[cfg(not(test))]
#[ctor::ctor]
fn init_client() {
    CLIENT.set(Client::from_env()).unwrap();
}
