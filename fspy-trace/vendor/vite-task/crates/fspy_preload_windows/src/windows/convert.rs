use std::fmt::Debug;

use fspy_shared::ipc::AccessMode;
use widestring::{U16CStr, U16CString, U16Str};
use winapi::{
    shared::ntdef::{HANDLE, POBJECT_ATTRIBUTES},
    um::winnt::ACCESS_MASK,
};

use crate::windows::winapi_utils::{
    access_mask_to_mode, combine_paths, get_path_name, get_u16_str,
};

pub trait ToAccessMode: Debug {
    unsafe fn to_access_mode(self) -> AccessMode;
}

impl ToAccessMode for AccessMode {
    unsafe fn to_access_mode(self) -> AccessMode {
        self
    }
}

impl ToAccessMode for ACCESS_MASK {
    unsafe fn to_access_mode(self) -> AccessMode {
        access_mask_to_mode(self)
    }
}

pub trait ToAbsolutePath {
    unsafe fn to_absolute_path<R, F: FnOnce(Option<&U16Str>) -> winsafe::SysResult<R>>(
        self,
        f: F,
    ) -> winsafe::SysResult<R>;
}

impl ToAbsolutePath for HANDLE {
    unsafe fn to_absolute_path<R, F: FnOnce(Option<&U16Str>) -> winsafe::SysResult<R>>(
        self,
        f: F,
    ) -> winsafe::SysResult<R> {
        // SAFETY: get_path_name performs FFI call with this HANDLE to retrieve the file path
        let resolved = unsafe { get_path_name(self) }.ok();
        let resolved = resolved.as_ref().map(|p| U16Str::from_slice(p));
        f(resolved)
    }
}

impl ToAbsolutePath for POBJECT_ATTRIBUTES {
    unsafe fn to_absolute_path<R, F: FnOnce(Option<&U16Str>) -> winsafe::SysResult<R>>(
        self,
        f: F,
    ) -> winsafe::SysResult<R> {
        // SAFETY: dereferencing POBJECT_ATTRIBUTES to read ObjectName field from Windows API struct
        let fname_str = unsafe { (*self).ObjectName.as_ref() }.map_or_else(
            || U16Str::from_slice(&[]),
            |object_name| {
                // SAFETY: reading UNICODE_STRING fields from a valid OBJECT_ATTRIBUTES
                unsafe { get_u16_str(object_name) }
            },
        );
        let fname_slice = fname_str.as_slice();
        let is_absolute = fname_slice.first() == Some(&b'\\'.into()) // \...
        || fname_slice.get(1) == Some(&b':'.into()); // C:...

        if is_absolute {
            f(Some(fname_str))
        } else {
            // SAFETY: dereferencing POBJECT_ATTRIBUTES to read RootDirectory handle
            let Ok(mut root_dir) = (unsafe { get_path_name((*self).RootDirectory) }) else {
                return f(None);
            };
            // If filename is empty, just use root_dir directly
            if fname_str.is_empty() {
                let root_dir_str = U16Str::from_slice(&root_dir);
                return f(Some(root_dir_str));
            }
            let root_dir_cstr = {
                root_dir.push(0);
                // SAFETY: we just pushed a null terminator, so the buffer is null-terminated
                unsafe { U16CStr::from_ptr_str(root_dir.as_ptr()) }
            };
            let fname_cstring = U16CString::from_ustr_truncate(fname_str);
            let abs_path = combine_paths(root_dir_cstr, fname_cstring.as_ucstr()).unwrap();
            f(Some(abs_path.to_u16_str()))
        }
    }
}
