pub(crate) mod client;
mod convert;
pub(crate) mod detour;
mod detours;
mod winapi_utils;

use std::slice;

use client::{Client, set_global_client};
use detours::DETOURS;
use fspy_detours_sys::{
    DetourFindPayloadEx, DetourIsHelperProcess, DetourRestoreAfterWith, DetourTransactionBegin,
    DetourTransactionCommit, DetourUpdateThread,
};
use fspy_shared::windows::PAYLOAD_ID;
use winapi::{
    shared::minwindef::{BOOL, DWORD, FALSE, HINSTANCE, TRUE},
    um::{
        processthreadsapi::GetCurrentThread,
        winnt::{self},
    },
};
use winapi_utils::{ck, ck_long};
use winsafe::SetLastError;

use crate::windows::detour::AttachContext;

fn dll_main(_hinstance: HINSTANCE, reason: u32) -> winsafe::SysResult<()> {
    // SAFETY: FFI call to check if this is a Detours helper process
    if unsafe { DetourIsHelperProcess() } == TRUE {
        return Ok(());
    }

    match reason {
        winnt::DLL_PROCESS_ATTACH => {
            // dbg!((current_exe(), std::process::id()));
            // SAFETY: FFI call to restore Detours state after DLL injection
            ck(unsafe { DetourRestoreAfterWith() })?;

            let mut payload_len: DWORD = 0;
            // SAFETY: FFI call to find the injected payload by GUID
            let payload_ptr =
                unsafe { DetourFindPayloadEx(&PAYLOAD_ID, &raw mut payload_len).cast::<u8>() };
            // SAFETY: creating a static slice from the payload pointer; lifetime is valid for process duration
            let payload_bytes = unsafe {
                slice::from_raw_parts::<'static, u8>(payload_ptr, payload_len.try_into().unwrap())
            };
            let client = Client::from_payload_bytes(payload_bytes);
            // SAFETY: setting the global client during single-threaded DLL_PROCESS_ATTACH
            unsafe { set_global_client(client) };

            let ctx = AttachContext::new();

            // SAFETY: FFI call to begin a Detours transaction
            ck_long(unsafe { DetourTransactionBegin() })?;
            // SAFETY: FFI call to update the current thread in the Detours transaction
            ck_long(unsafe { DetourUpdateThread(GetCurrentThread().cast()) })?;

            for d in DETOURS {
                // SAFETY: attaching each detour within the active Detours transaction
                unsafe { d.attach(&ctx) }?;
            }

            // SAFETY: FFI call to commit the Detours transaction
            ck_long(unsafe { DetourTransactionCommit() })?;
        }
        winnt::DLL_PROCESS_DETACH => {
            // SAFETY: FFI call to begin a Detours transaction for detaching
            ck(unsafe { DetourTransactionBegin() })?;
            // SAFETY: FFI call to update the current thread in the Detours transaction
            ck(unsafe { DetourUpdateThread(GetCurrentThread().cast()) })?;

            for d in DETOURS {
                // SAFETY: detaching each detour within the active Detours transaction
                unsafe { d.detach() }?;
            }

            // SAFETY: FFI call to commit the Detours transaction
            ck(unsafe { DetourTransactionCommit() })?;
        }
        _ => {}
    }
    Ok(())
}

#[unsafe(no_mangle)]
extern "system" fn DllMain(hinstance: HINSTANCE, reason: u32, _: *mut std::ffi::c_void) -> BOOL {
    match dll_main(hinstance, reason) {
        Ok(()) => TRUE,
        Err(err) => {
            SetLastError(err);
            FALSE
        }
    }
}
