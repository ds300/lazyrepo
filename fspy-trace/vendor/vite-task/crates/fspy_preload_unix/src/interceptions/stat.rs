use fspy_shared::ipc::AccessMode;
use libc::{c_char, c_int, stat as stat_struct};

use crate::{
    client::{convert::PathAt, handle_open},
    macros::intercept,
};

intercept!(stat(64): unsafe extern "C" fn(path: *const c_char, buf: *mut stat_struct) -> c_int);
unsafe extern "C" fn stat(path: *const c_char, buf: *mut stat_struct) -> c_int {
    // SAFETY: path is a valid C string pointer provided by the caller of the interposed function
    unsafe {
        handle_open(path, AccessMode::READ);
    }
    // SAFETY: calling the original libc stat() with the same arguments forwarded from the interposed function
    unsafe { stat::original()(path, buf) }
}

intercept!(lstat(64): unsafe extern "C" fn(path: *const c_char, buf: *mut stat_struct) -> c_int);
unsafe extern "C" fn lstat(path: *const c_char, buf: *mut stat_struct) -> c_int {
    // TODO: add accessmode ReadNoFollow
    // SAFETY: path is a valid C string pointer provided by the caller of the interposed function
    unsafe {
        handle_open(path, AccessMode::READ);
    }
    // SAFETY: calling the original libc lstat() with the same arguments forwarded from the interposed function
    unsafe { lstat::original()(path, buf) }
}

intercept!(fstatat(64): unsafe extern "C" fn(dirfd: c_int, pathname: *const c_char, buf: *mut stat_struct, flags: c_int) -> c_int);
unsafe extern "C" fn fstatat(
    dirfd: c_int,
    pathname: *const c_char,
    buf: *mut stat_struct,
    flags: c_int,
) -> c_int {
    // SAFETY: dirfd and pathname are valid arguments provided by the caller of the interposed function
    unsafe {
        handle_open(PathAt(dirfd, pathname), AccessMode::READ);
    }
    // SAFETY: calling the original libc fstatat() with the same arguments forwarded from the interposed function
    unsafe { fstatat::original()(dirfd, pathname, buf, flags) }
}
