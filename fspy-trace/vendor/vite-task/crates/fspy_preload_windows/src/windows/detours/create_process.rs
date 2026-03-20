use fspy_detours_sys::{DetourCreateProcessWithDllExA, DetourCreateProcessWithDllExW};
use winapi::{
    shared::{
        minwindef::{BOOL, DWORD, LPVOID},
        ntdef::{LPCSTR, LPSTR},
    },
    um::{
        minwinbase::LPSECURITY_ATTRIBUTES,
        processthreadsapi::{
            CreateProcessA, CreateProcessW, LPPROCESS_INFORMATION, LPSTARTUPINFOA, LPSTARTUPINFOW,
            ResumeThread,
        },
        winbase::CREATE_SUSPENDED,
        winnt::{LPCWSTR, LPWSTR},
    },
};

use crate::windows::{
    client::global_client,
    detour::{Detour, DetourAny},
};

thread_local! {
    static IS_HOOKING_CREATE_PROCESS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

struct HookGuard;
impl HookGuard {
    pub fn new() -> Option<Self> {
        let already_hooking = IS_HOOKING_CREATE_PROCESS.with(|c| {
            let v = c.get();
            c.set(true);
            v
        });
        if already_hooking { None } else { Some(Self) }
    }
}
impl Drop for HookGuard {
    fn drop(&mut self) {
        IS_HOOKING_CREATE_PROCESS.with(|c| {
            c.set(false);
        });
    }
}

static DETOUR_CREATE_PROCESS_W: Detour<
    unsafe extern "system" fn(
        LPCWSTR,
        LPWSTR,
        LPSECURITY_ATTRIBUTES,
        LPSECURITY_ATTRIBUTES,
        BOOL,
        DWORD,
        LPVOID,
        LPCWSTR,
        LPSTARTUPINFOW,
        LPPROCESS_INFORMATION,
    ) -> i32,
> =
    // SAFETY: initializing Detour with the real CreateProcessW function pointer and our replacement
    unsafe {
        Detour::new(c"CreateProcessW", CreateProcessW, {
            unsafe extern "system" fn new_fn(
                lp_application_name: LPCWSTR,
                lp_command_line: LPWSTR,
                lp_process_attributes: LPSECURITY_ATTRIBUTES,
                lp_thread_attributes: LPSECURITY_ATTRIBUTES,
                b_inherit_handles: BOOL,
                dw_creation_flags: DWORD,
                lp_environment: LPVOID,
                lp_current_directory: LPCWSTR,
                lp_startup_info: LPSTARTUPINFOW,
                lp_process_information: LPPROCESS_INFORMATION,
            ) -> BOOL {
                unsafe extern "system" fn create_process_with_payload_w(
                    lp_application_name: LPCWSTR,
                    lp_command_line: LPWSTR,
                    lp_process_attributes: LPSECURITY_ATTRIBUTES,
                    lp_thread_attributes: LPSECURITY_ATTRIBUTES,
                    b_inherit_handles: BOOL,
                    dw_creation_flags: DWORD,
                    lp_environment: LPVOID,
                    lp_current_directory: LPCWSTR,
                    lp_startup_info: LPSTARTUPINFOW,
                    lp_process_information: LPPROCESS_INFORMATION,
                ) -> BOOL {
                    // SAFETY: calling original CreateProcessW with CREATE_SUSPENDED to inject DLL before resume
                    let ret = unsafe {
                        (DETOUR_CREATE_PROCESS_W.real())(
                            lp_application_name,
                            lp_command_line,
                            lp_process_attributes,
                            lp_thread_attributes,
                            b_inherit_handles,
                            dw_creation_flags | CREATE_SUSPENDED,
                            lp_environment,
                            lp_current_directory,
                            lp_startup_info,
                            lp_process_information,
                        )
                    };
                    if ret == 0 {
                        return 0;
                    }

                    // SAFETY: copying payload to child process and dereferencing lp_process_information
                    let ret = unsafe {
                        global_client().prepare_child_process((*lp_process_information).hProcess)
                    };

                    if ret == 0 {
                        return 0;
                    }
                    if dw_creation_flags & CREATE_SUSPENDED == 0 {
                        // SAFETY: resuming the suspended child thread after DLL injection
                        let ret = unsafe { ResumeThread((*lp_process_information).hThread) };
                        if ret == (-1i32).cast_unsigned() {
                            return 0;
                        }
                    }
                    ret
                }

                let Some(_hook_guard) = HookGuard::new() else {
                    // Detect re-entrance and avoid double hooking
                    // SAFETY: calling original CreateProcessW with all original arguments
                    return unsafe {
                        (DETOUR_CREATE_PROCESS_W.real())(
                            lp_application_name,
                            lp_command_line,
                            lp_process_attributes,
                            lp_thread_attributes,
                            b_inherit_handles,
                            dw_creation_flags,
                            lp_environment,
                            lp_current_directory,
                            lp_startup_info,
                            lp_process_information,
                        )
                    };
                };

                // SAFETY: accessing the global client initialized during DLL_PROCESS_ATTACH
                let client = unsafe { global_client() };

                // SAFETY: calling DetourCreateProcessWithDllExW to create process with our DLL injected
                unsafe {
                    DetourCreateProcessWithDllExW(
                        lp_application_name,
                        lp_command_line,
                        lp_process_attributes,
                        lp_thread_attributes,
                        b_inherit_handles,
                        dw_creation_flags,
                        lp_environment,
                        lp_current_directory,
                        lp_startup_info,
                        lp_process_information,
                        client.ansi_dll_path().as_ptr().cast(),
                        Some(create_process_with_payload_w),
                    )
                }
            }
            new_fn
        })
    };

static DETOUR_CREATE_PROCESS_A: Detour<
    unsafe extern "system" fn(
        LPCSTR,
        LPSTR,
        LPSECURITY_ATTRIBUTES,
        LPSECURITY_ATTRIBUTES,
        BOOL,
        DWORD,
        LPVOID,
        LPCSTR,
        LPSTARTUPINFOA,
        LPPROCESS_INFORMATION,
    ) -> i32,
> =
    // SAFETY: initializing Detour with the real CreateProcessA function pointer and our replacement
    unsafe {
        Detour::new(c"CreateProcessA", CreateProcessA, {
            unsafe extern "system" fn new_fn(
                lp_application_name: LPCSTR,
                lp_command_line: LPSTR,
                lp_process_attributes: LPSECURITY_ATTRIBUTES,
                lp_thread_attributes: LPSECURITY_ATTRIBUTES,
                b_inherit_handles: BOOL,
                dw_creation_flags: DWORD,
                lp_environment: LPVOID,
                lp_current_directory: LPCSTR,
                lp_startup_info: LPSTARTUPINFOA,
                lp_process_information: LPPROCESS_INFORMATION,
            ) -> BOOL {
                unsafe extern "system" fn create_process_with_payload_a(
                    lp_application_name: LPCSTR,
                    lp_command_line: LPSTR,
                    lp_process_attributes: LPSECURITY_ATTRIBUTES,
                    lp_thread_attributes: LPSECURITY_ATTRIBUTES,
                    b_inherit_handles: BOOL,
                    dw_creation_flags: DWORD,
                    lp_environment: LPVOID,
                    lp_current_directory: LPCSTR,
                    lp_startup_info: LPSTARTUPINFOA,
                    lp_process_information: LPPROCESS_INFORMATION,
                ) -> BOOL {
                    // SAFETY: calling original CreateProcessA with CREATE_SUSPENDED to inject DLL before resume
                    let ret = unsafe {
                        (DETOUR_CREATE_PROCESS_A.real())(
                            lp_application_name,
                            lp_command_line,
                            lp_process_attributes,
                            lp_thread_attributes,
                            b_inherit_handles,
                            dw_creation_flags | CREATE_SUSPENDED,
                            lp_environment,
                            lp_current_directory,
                            lp_startup_info,
                            lp_process_information,
                        )
                    };
                    if ret == 0 {
                        return 0;
                    }

                    // SAFETY: copying payload to child process and dereferencing lp_process_information
                    let ret = unsafe {
                        global_client().prepare_child_process((*lp_process_information).hProcess)
                    };

                    if ret == 0 {
                        return 0;
                    }
                    if dw_creation_flags & CREATE_SUSPENDED == 0 {
                        // SAFETY: resuming the suspended child thread after DLL injection
                        let ret = unsafe { ResumeThread((*lp_process_information).hThread) };
                        if ret == (-1i32).cast_unsigned() {
                            return 0;
                        }
                    }
                    ret
                }

                let Some(_hook_guard) = HookGuard::new() else {
                    // Detect re-entrance and avoid double hooking
                    // SAFETY: calling original CreateProcessA with all original arguments
                    return unsafe {
                        (DETOUR_CREATE_PROCESS_A.real())(
                            lp_application_name,
                            lp_command_line,
                            lp_process_attributes,
                            lp_thread_attributes,
                            b_inherit_handles,
                            dw_creation_flags,
                            lp_environment,
                            lp_current_directory,
                            lp_startup_info,
                            lp_process_information,
                        )
                    };
                };
                // SAFETY: accessing the global client initialized during DLL_PROCESS_ATTACH
                let client = unsafe { global_client() };

                // SAFETY: calling DetourCreateProcessWithDllExA to create process with our DLL injected
                unsafe {
                    DetourCreateProcessWithDllExA(
                        lp_application_name,
                        lp_command_line,
                        lp_process_attributes,
                        lp_thread_attributes,
                        b_inherit_handles,
                        dw_creation_flags,
                        lp_environment,
                        lp_current_directory,
                        lp_startup_info,
                        lp_process_information,
                        client.ansi_dll_path().as_ptr().cast(),
                        Some(create_process_with_payload_a),
                    )
                }
            }
            new_fn
        })
    };
pub const DETOURS: &[DetourAny] =
    &[DETOUR_CREATE_PROCESS_W.as_any(), DETOUR_CREATE_PROCESS_A.as_any()];
