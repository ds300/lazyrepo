#[cfg(feature = "supervisor")]
pub mod alloc;

#[cfg(feature = "supervisor")]
use alloc::Alloced;
use std::os::raw::c_int;

use libc::syscall;

/// # Safety
/// The `args` pointer must be valid for the given `operation`, or null if the operation
/// does not require arguments.
unsafe fn seccomp(
    operation: libc::c_uint,
    flags: libc::c_uint,
    args: *mut libc::c_void,
) -> nix::Result<libc::c_int> {
    // SAFETY: caller guarantees `args` is valid for the given seccomp operation
    let ret = unsafe { syscall(libc::SYS_seccomp, operation, flags, args) };
    if ret < 0 {
        return Err(nix::Error::last());
    }
    Ok(c_int::try_from(ret).unwrap())
}

#[cfg(feature = "supervisor")]
fn get_notif_sizes() -> nix::Result<libc::seccomp_notif_sizes> {
    use std::mem::zeroed;
    // SAFETY: `seccomp_notif_sizes` is a plain data struct safe to zero-initialize
    let mut sizes = unsafe { zeroed::<libc::seccomp_notif_sizes>() };
    // SAFETY: `sizes` is a valid mutable pointer to a `seccomp_notif_sizes` struct,
    // which is the expected argument for `SECCOMP_GET_NOTIF_SIZES`
    unsafe { seccomp(libc::SECCOMP_GET_NOTIF_SIZES, 0, (&raw mut sizes).cast()) }?;
    Ok(sizes)
}

/// Receives a seccomp notification from the given file descriptor into the provided buffer.
///
/// # Errors
/// Returns an error if the ioctl call fails (e.g., the fd is invalid or the kernel
/// returns an error).
#[cfg(feature = "supervisor")]
pub fn notif_recv(
    fd: std::os::fd::BorrowedFd<'_>,
    notif_buf: &mut Alloced<libc::seccomp_notif>,
) -> nix::Result<()> {
    use std::os::fd::AsRawFd;
    const SECCOMP_IOCTL_NOTIF_RECV: libc::Ioctl = 3_226_476_800u64 as libc::Ioctl;
    // SAFETY: `notif_buf.zeroed()` returns a valid mutable pointer to a zeroed
    // `seccomp_notif` buffer with sufficient size for the kernel's notification struct
    let ret = unsafe {
        libc::ioctl(fd.as_raw_fd(), SECCOMP_IOCTL_NOTIF_RECV, (&raw mut *notif_buf.zeroed()))
    };
    if ret < 0 {
        return Err(nix::Error::last());
    }
    Ok(())
}

/// Installs a seccomp user notification filter and returns the notification file descriptor.
///
/// # Errors
/// Returns an error if the seccomp syscall fails (e.g., invalid filter program or
/// insufficient privileges).
#[cfg(feature = "target")]
pub fn install_unotify_filter(prog: &[libc::sock_filter]) -> nix::Result<std::os::fd::OwnedFd> {
    use std::os::fd::FromRawFd;
    let mut filter = libc::sock_fprog {
        len: prog.len().try_into().unwrap(),
        filter: prog.as_ptr().cast_mut().cast(),
    };

    // SAFETY: `filter` is a valid `sock_fprog` pointing to the BPF program slice,
    // and `SECCOMP_FILTER_FLAG_NEW_LISTENER` requests a notification fd
    #[expect(clippy::cast_possible_truncation, reason = "flag value fits in u32")]
    let fd = unsafe {
        seccomp(
            libc::SECCOMP_SET_MODE_FILTER,
            libc::SECCOMP_FILTER_FLAG_NEW_LISTENER as _,
            (&raw mut filter).cast(),
        )
    }?;

    // SAFETY: the seccomp syscall with `SECCOMP_FILTER_FLAG_NEW_LISTENER` returns
    // a valid, owned file descriptor on success
    Ok(unsafe { std::os::fd::OwnedFd::from_raw_fd(fd) })
}
