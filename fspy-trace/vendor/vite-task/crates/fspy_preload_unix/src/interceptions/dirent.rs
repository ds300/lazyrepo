use fspy_shared::ipc::AccessMode;
use libc::{DIR, c_char, c_int, c_long, c_void};

use crate::{
    client::{convert::Fd, handle_open},
    macros::intercept,
};

intercept!(scandir(64): unsafe extern "C" fn (
    dirname: *const c_char,
    namelist: *mut c_void,
    select: *const c_void,
    compar: *const c_void,
) -> c_int);
unsafe extern "C" fn scandir(
    dirname: *const c_char,
    namelist: *mut c_void,
    select: *const c_void,
    compar: *const c_void,
) -> c_int {
    // SAFETY: dirname is a valid C string pointer provided by the caller of the interposed function
    unsafe { handle_open(dirname, AccessMode::READ_DIR) }
    // SAFETY: calling the original libc scandir() with the same arguments forwarded from the interposed function
    unsafe { scandir::original()(dirname, namelist, select, compar) }
}

#[cfg(target_os = "macos")]
mod macos_only {
    use super::{AccessMode, c_char, c_int, c_void, handle_open, intercept};
    intercept!(scandir_b: unsafe extern "C" fn (
        dirname: *const c_char,
        namelist: *mut c_void,
        select: *const c_void,
        compar: *const c_void,
    ) -> c_int);
    unsafe extern "C" fn scandir_b(
        dirname: *const c_char,
        namelist: *mut c_void,
        select: *const c_void,
        compar: *const c_void,
    ) -> c_int {
        // SAFETY: dirname is a valid C string pointer provided by the caller of the interposed function
        unsafe { handle_open(dirname, AccessMode::READ_DIR) };
        // SAFETY: calling the original libc scandir_b() with the same arguments forwarded from the interposed function
        unsafe { scandir_b::original()(dirname, namelist, select, compar) }
    }
}

intercept!(getdirentries(64): unsafe extern "C" fn (fd: c_int, buf: *mut c_char, nbytes: c_int, basep: *mut c_long) -> c_int);
unsafe extern "C" fn getdirentries(
    fd: c_int,
    buf: *mut c_char,
    nbytes: c_int,
    basep: *mut c_long,
) -> c_int {
    // SAFETY: fd is a valid file descriptor provided by the caller of the interposed function
    unsafe { handle_open(Fd(fd), AccessMode::READ_DIR) };
    // SAFETY: calling the original libc getdirentries() with the same arguments forwarded from the interposed function
    unsafe { getdirentries::original()(fd, buf, nbytes, basep) }
}

intercept!(fdopendir(64): unsafe extern "C" fn (fd: c_int) -> *mut DIR);
unsafe extern "C" fn fdopendir(fd: c_int) -> *mut DIR {
    // SAFETY: fd is a valid file descriptor provided by the caller of the interposed function
    unsafe { handle_open(Fd(fd), AccessMode::READ_DIR) };
    // SAFETY: calling the original libc fdopendir() with the same arguments forwarded from the interposed function
    unsafe { fdopendir::original()(fd) }
}

intercept!(opendir(64): unsafe extern "C" fn (*const c_char) -> *mut DIR);
unsafe extern "C" fn opendir(dir_name: *const c_char) -> *mut DIR {
    // SAFETY: dir_name is a valid C string pointer provided by the caller of the interposed function
    unsafe { handle_open(dir_name, AccessMode::READ_DIR) };
    // SAFETY: calling the original libc opendir() with the same arguments forwarded from the interposed function
    unsafe { opendir::original()(dir_name) }
}
