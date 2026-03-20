use libc::FILE;

use crate::{
    client::{
        convert::{ModeStr, OpenFlags, PathAt},
        handle_open,
    },
    libc::{c_char, c_int},
    macros::intercept,
};

const fn has_mode_arg(o_flags: c_int) -> bool {
    if o_flags & libc::O_CREAT != 0 {
        return true;
    }
    #[cfg(target_os = "linux")]
    if o_flags & libc::O_TMPFILE != 0 {
        return true;
    }
    false
}

#[cfg(not(target_os = "macos"))]
type Mode = libc::mode_t;
#[cfg(target_os = "macos")] // https://github.com/tailhook/openat/issues/21#issuecomment-535914957
type Mode = c_int;

intercept!(open(64): unsafe extern "C" fn(*const c_char, c_int, args: ...) -> c_int);
unsafe extern "C" fn open(path: *const c_char, flags: c_int, mut args: ...) -> c_int {
    // SAFETY: path is a valid C string pointer provided by the caller of the interposed function
    unsafe { handle_open(path, OpenFlags(flags)) };
    if has_mode_arg(flags) {
        // SAFETY: when O_CREAT or O_TMPFILE is set, a mode_t argument is required by the open() contract
        let mode: Mode = unsafe { args.arg() };
        // SAFETY: calling the original libc open() with the same arguments forwarded from the interposed function
        unsafe { open::original()(path, flags, mode) }
    } else {
        // SAFETY: calling the original libc open() with the same arguments forwarded from the interposed function
        unsafe { open::original()(path, flags) }
    }
}

intercept!(openat(64): unsafe extern "C" fn(c_int, *const c_char, c_int, ...) -> c_int);
unsafe extern "C" fn openat(
    dirfd: c_int,
    path: *const c_char,
    flags: c_int,
    mut args: ...
) -> c_int {
    // SAFETY: dirfd and path are valid arguments provided by the caller of the interposed function
    unsafe { handle_open(PathAt(dirfd, path), OpenFlags(flags)) };

    if has_mode_arg(flags) {
        // https://github.com/tailhook/openat/issues/21#issuecomment-535914957
        // SAFETY: when O_CREAT or O_TMPFILE is set, a mode_t argument is required by the openat() contract
        let mode: Mode = unsafe { args.arg() };
        // SAFETY: calling the original libc openat() with the same arguments forwarded from the interposed function
        unsafe { openat::original()(dirfd, path, flags, mode) }
    } else {
        // SAFETY: calling the original libc openat() with the same arguments forwarded from the interposed function
        unsafe { openat::original()(dirfd, path, flags) }
    }
}

intercept!(fopen(64): unsafe extern "C" fn(path: *const c_char, mode: *const c_char) -> *mut FILE);
unsafe extern "C" fn fopen(path: *const c_char, mode: *const c_char) -> *mut libc::FILE {
    // SAFETY: path and mode are valid C string pointers provided by the caller of the interposed function
    unsafe { handle_open(path, ModeStr(mode)) };
    // SAFETY: calling the original libc fopen() with the same arguments forwarded from the interposed function
    unsafe { fopen::original()(path, mode) }
}

intercept!(freopen(64): unsafe extern "C" fn(path: *const c_char, mode: *const c_char, stream: *mut FILE) -> *mut FILE);
unsafe extern "C" fn freopen(
    path: *const c_char,
    mode: *const c_char,
    stream: *mut FILE,
) -> *mut FILE {
    // SAFETY: path and mode are valid C string pointers provided by the caller of the interposed function
    unsafe { handle_open(path, ModeStr(mode)) };
    // SAFETY: calling the original libc freopen() with the same arguments forwarded from the interposed function
    unsafe { freopen::original()(path, mode, stream) }
}
