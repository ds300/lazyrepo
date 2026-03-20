#![cfg(windows)]
mod test_utils;

use std::{ffi::OsStr, os::windows::ffi::OsStrExt, path::Path, ptr::null_mut};

use fspy::AccessMode;
use test_log::test;
use test_utils::assert_contains;
use winapi::um::processthreadsapi::{
    CreateProcessA, CreateProcessW, PROCESS_INFORMATION, STARTUPINFOA, STARTUPINFOW,
};

#[test(tokio::test)]
async fn create_process_a() -> anyhow::Result<()> {
    let accesses = track_fn!((), |(): ()| {
        // SAFETY: zeroing STARTUPINFOA is valid for the Windows API
        let mut si: STARTUPINFOA = unsafe { std::mem::zeroed() };
        // SAFETY: zeroing PROCESS_INFORMATION is valid for the Windows API
        let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: all pointers are valid or null_mut as required by CreateProcessA
        unsafe {
            CreateProcessA(
                c"C:\\fspy_test_not_exist_program.exe".as_ptr().cast(),
                null_mut(),
                null_mut(),
                null_mut(),
                0,
                0,
                null_mut(),
                null_mut(),
                &raw mut si,
                &raw mut pi,
            )
        };
    })
    .await?;
    assert_contains(&accesses, Path::new("C:\\fspy_test_not_exist_program.exe"), AccessMode::READ);

    Ok(())
}

#[test(tokio::test)]
async fn create_process_w() -> anyhow::Result<()> {
    let accesses = track_fn!((), |(): ()| {
        // SAFETY: zeroing STARTUPINFOW is valid for the Windows API
        let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
        // SAFETY: zeroing PROCESS_INFORMATION is valid for the Windows API
        let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
        let program =
            OsStr::new("C:\\fspy_test_not_exist_program.exe\0").encode_wide().collect::<Vec<u16>>();
        // SAFETY: all pointers are valid or null_mut as required by CreateProcessW
        unsafe {
            CreateProcessW(
                program.as_ptr(),
                null_mut(),
                null_mut(),
                null_mut(),
                0,
                0,
                null_mut(),
                null_mut(),
                &raw mut si,
                &raw mut pi,
            )
        };
    })
    .await?;
    assert_contains(&accesses, Path::new("C:\\fspy_test_not_exist_program.exe"), AccessMode::READ);

    Ok(())
}
