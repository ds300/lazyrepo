use std::{
    ffi::VaList,
    mem::{self, MaybeUninit},
    slice,
};

use libc::{c_char, c_int};
use nix::Error;

// https://github.com/redox-os/relibc/blob/710911febb07a43716a6236cc9e5b864e227e36e/src/header/unistd/mod.rs#L1094
#[expect(clippy::similar_names, reason = "arg0 and argc are standard C naming conventions")]
pub unsafe fn with_argv(
    mut va: VaList,
    arg0: *const c_char,
    f: impl FnOnce(&[*const c_char], VaList) -> c_int,
) -> c_int {
    let argc = 1 + {
        let mut va = va.clone();
        // Safety: argv is guaranteed to be NULL-terminated
        core::iter::from_fn(|| Some(unsafe { va.arg::<*const c_char>() }))
            .position(|s| {
                // Find the NULL terminator
                s.is_null()
            })
            .unwrap()
    };

    let mut stack: [MaybeUninit<*const c_char>; 32] = [MaybeUninit::uninit(); 32];

    let out = if argc < 32 {
        stack.as_mut_slice()
    } else if argc < 4096 {
        // TODO: Use ARG_MAX, not this hardcoded constant
        // SAFETY: requesting a heap allocation of the correct size for argc pointers
        let ptr = unsafe { libc::malloc(argc * mem::size_of::<*const c_char>()) };
        if ptr.is_null() {
            Error::ENOMEM.set();
            return -1;
        }
        // SAFETY: ptr is non-null (checked above), properly aligned, and points to argc elements worth of allocated memory
        unsafe { slice::from_raw_parts_mut(ptr.cast::<MaybeUninit<*const c_char>>(), argc) }
    } else {
        Error::E2BIG.set();
        return -1;
    };
    out[0].write(arg0);

    for item in out.iter_mut().take(argc).skip(1) {
        // SAFETY: extracting the next *const c_char argument from the va_list; the count was pre-validated
        item.write(unsafe { va.arg::<*const c_char>() });
    }
    out[argc].write(core::ptr::null());
    // SAFETY: consuming the NULL terminator from the va_list to advance past it
    unsafe { va.arg::<*const c_char>() };

    // Safety: MaybeUninit<*const c_char> has the same layout as *const c_char,
    // and all elements have been initialized via write() above.
    f(unsafe { &*(&raw const *out as *const [*const c_char]) }, va);

    // f only returns if it fails
    if argc >= 32 {
        // SAFETY: out was allocated with libc::malloc above (argc >= 32 branch), so it must be freed with libc::free
        unsafe { libc::free(out.as_mut_ptr().cast()) };
    }
    -1
}
