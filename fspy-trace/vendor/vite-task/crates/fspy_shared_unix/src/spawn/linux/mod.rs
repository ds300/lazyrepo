#[cfg(not(target_env = "musl"))]
use std::{ffi::OsStr, os::unix::ffi::OsStrExt as _, path::Path};

use fspy_seccomp_unotify::{payload::SeccompPayload, target::install_target};
#[cfg(not(target_env = "musl"))]
use memmap2::Mmap;

#[cfg(not(target_env = "musl"))]
use crate::{elf, exec::ensure_env, open_exec::open_executable};
use crate::{
    exec::Exec,
    payload::{EncodedPayload, PAYLOAD_ENV_NAME},
};

const LD_PRELOAD: &str = "LD_PRELOAD";

pub struct PreExec(SeccompPayload);
impl PreExec {
    /// Installs the seccomp unotify filter for the current process.
    ///
    /// # Errors
    ///
    /// Returns an error if the seccomp filter installation fails.
    pub fn run(&self) -> nix::Result<()> {
        install_target(&self.0)
    }
}

pub fn handle_exec(
    command: &mut Exec,
    encoded_payload: &EncodedPayload,
) -> nix::Result<Option<PreExec>> {
    // On musl targets, LD_PRELOAD is not available (cdylib not supported).
    // Always use seccomp-based tracking instead.
    #[cfg(not(target_env = "musl"))]
    {
        let executable_fd = open_executable(Path::new(OsStr::from_bytes(&command.program)))?;
        // SAFETY: The file descriptor is valid and we only read from the mapping.
        let executable_mmap = unsafe { Mmap::map(&executable_fd) }.map_err(|io_error| {
            nix::Error::try_from(io_error).unwrap_or(nix::Error::UnknownErrno)
        })?;
        if elf::is_dynamically_linked_to_libc(executable_mmap)? {
            ensure_env(
                &mut command.envs,
                LD_PRELOAD,
                encoded_payload.payload.preload_path.as_os_str().as_bytes(),
            )?;
            ensure_env(&mut command.envs, PAYLOAD_ENV_NAME, &encoded_payload.encoded_string)?;
            return Ok(None);
        }
    }

    command.envs.retain(|(name, _)| name != LD_PRELOAD && name != PAYLOAD_ENV_NAME);
    Ok(Some(PreExec(encoded_payload.payload.seccomp_payload.clone())))
}
