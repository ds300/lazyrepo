use std::io;

use fspy_seccomp_unotify::supervisor::handler::arg::{CStrPtr, Caller, Fd};

use super::SyscallHandler;

impl SyscallHandler {
    #[cfg(target_arch = "x86_64")]
    pub(super) fn stat(&mut self, caller: Caller, (path,): (CStrPtr,)) -> io::Result<()> {
        self.handle_open(caller, Fd::cwd(), path, libc::O_RDONLY)
    }

    #[cfg(target_arch = "x86_64")]
    pub(super) fn lstat(&mut self, caller: Caller, (path,): (CStrPtr,)) -> io::Result<()> {
        self.handle_open(caller, Fd::cwd(), path, libc::O_RDONLY)
    }

    #[cfg(target_arch = "aarch64")]
    pub(super) fn fstatat(
        &mut self,
        caller: Caller,
        (dir_fd, path_ptr): (Fd, CStrPtr),
    ) -> io::Result<()> {
        self.handle_open(caller, dir_fd, path_ptr, libc::O_RDONLY)
    }

    #[cfg(target_arch = "x86_64")]
    pub(super) fn newfstatat(
        &mut self,
        caller: Caller,
        (dir_fd, path_ptr): (Fd, CStrPtr),
    ) -> io::Result<()> {
        self.handle_open(caller, dir_fd, path_ptr, libc::O_RDONLY)
    }

    /// statx(2) — modern replacement for stat/fstatat used by newer glibc.
    pub(super) fn statx(
        &mut self,
        caller: Caller,
        (dir_fd, path_ptr): (Fd, CStrPtr),
    ) -> io::Result<()> {
        self.handle_open(caller, dir_fd, path_ptr, libc::O_RDONLY)
    }

    /// access(2) — check file accessibility (e.g. existsSync in Node.js).
    #[cfg(target_arch = "x86_64")]
    pub(super) fn access(&mut self, caller: Caller, (path,): (CStrPtr,)) -> io::Result<()> {
        self.handle_open(caller, Fd::cwd(), path, libc::O_RDONLY)
    }

    /// faccessat(2) — check file accessibility relative to directory fd.
    pub(super) fn faccessat(
        &mut self,
        caller: Caller,
        (dir_fd, path_ptr): (Fd, CStrPtr),
    ) -> io::Result<()> {
        self.handle_open(caller, dir_fd, path_ptr, libc::O_RDONLY)
    }

    /// faccessat2(2) — extended faccessat with flags parameter.
    pub(super) fn faccessat2(
        &mut self,
        caller: Caller,
        (dir_fd, path_ptr): (Fd, CStrPtr),
    ) -> io::Result<()> {
        self.handle_open(caller, dir_fd, path_ptr, libc::O_RDONLY)
    }
}
