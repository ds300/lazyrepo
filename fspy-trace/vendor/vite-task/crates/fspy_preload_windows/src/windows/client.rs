use std::{cell::SyncUnsafeCell, ffi::CStr, mem::MaybeUninit};

use bincode::{borrow_decode_from_slice, encode_to_vec};
use fspy_detours_sys::DetourCopyPayloadToProcess;
use fspy_shared::{
    ipc::{BINCODE_CONFIG, PathAccess, channel::Sender},
    windows::{PAYLOAD_ID, Payload},
};
use winapi::{shared::minwindef::BOOL, um::winnt::HANDLE};

pub struct Client<'a> {
    payload: Payload<'a>,
    ipc_sender: Option<Sender>,
}

impl<'a> Client<'a> {
    pub fn from_payload_bytes(payload_bytes: &'a [u8]) -> Self {
        let (payload, decoded_len) =
            borrow_decode_from_slice::<'a, Payload, _>(payload_bytes, BINCODE_CONFIG).unwrap();
        assert_eq!(decoded_len, payload_bytes.len());

        let ipc_sender = match payload.channel_conf.sender() {
            Ok(sender) => Some(sender),
            Err(err) => {
                // this can happen if the process is started after the root target process has exited.
                // By that time the channel would have been closed in the receiver side.
                // In this case we just leave a message and skip sending any path accesses.
                #[expect(
                    clippy::print_stderr,
                    reason = "preload library uses stderr for debug diagnostics"
                )]
                {
                    eprintln!("fspy: failed to create ipc sender: {err}");
                }
                None
            }
        };

        Self { payload, ipc_sender }
    }

    pub fn send(&self, access: PathAccess<'_>) {
        let Some(sender) = &self.ipc_sender else {
            return;
        };
        sender.write_encoded(&access, BINCODE_CONFIG).expect("failed to send path access");
    }

    pub unsafe fn prepare_child_process(&self, child_handle: HANDLE) -> BOOL {
        let payload_bytes = encode_to_vec(&self.payload, BINCODE_CONFIG).unwrap();
        // SAFETY: FFI call to DetourCopyPayloadToProcess with valid handle and payload buffer
        unsafe {
            DetourCopyPayloadToProcess(
                child_handle,
                &PAYLOAD_ID,
                payload_bytes.as_ptr().cast(),
                payload_bytes.len().try_into().unwrap(),
            )
        }
    }

    pub const fn ansi_dll_path(&self) -> &'a CStr {
        // SAFETY: payload.ansi_dll_path_with_nul is guaranteed to be a valid null-terminated byte string
        unsafe { CStr::from_bytes_with_nul_unchecked(self.payload.ansi_dll_path_with_nul) }
    }
}

static CLIENT: SyncUnsafeCell<MaybeUninit<Client<'static>>> =
    SyncUnsafeCell::new(MaybeUninit::uninit());

pub unsafe fn set_global_client(client: Client<'static>) {
    // SAFETY: called once during DLL_PROCESS_ATTACH before any concurrent access
    unsafe { *CLIENT.get() = MaybeUninit::new(client) }
}

pub unsafe fn global_client() -> &'static Client<'static> {
    // SAFETY: CLIENT is initialized via set_global_client during DLL_PROCESS_ATTACH
    unsafe { (*CLIENT.get()).assume_init_ref() }
}
