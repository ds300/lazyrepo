use std::slice;

use fspy_shared::ipc::AccessMode;
use smallvec::SmallVec;
use widestring::{U16CStr, U16Str};
use winapi::{
    ctypes::c_long,
    shared::{
        minwindef::{BOOL, FALSE, HLOCAL, MAX_PATH, ULONG},
        ntdef::{HANDLE, HRESULT, PCWSTR, PWSTR, UNICODE_STRING},
        winerror::{NO_ERROR, S_OK},
    },
    um::{
        fileapi::GetFinalPathNameByHandleW,
        winnt::{
            ACCESS_MASK, FILE_APPEND_DATA, FILE_READ_DATA, FILE_WRITE_DATA, GENERIC_READ,
            GENERIC_WRITE,
        },
    },
};
use winsafe::{GetLastError, co};

pub fn ck(b: BOOL) -> winsafe::SysResult<()> {
    if b == FALSE { Err(GetLastError()) } else { Ok(()) }
}

pub const fn ck_long(val: c_long) -> winsafe::SysResult<()> {
    if 0 == NO_ERROR {
        Ok(())
    } else {
        // SAFETY: creating an ERROR from the raw c_long value for the Windows error code
        Err(unsafe { winsafe::co::ERROR::from_raw(val.cast_unsigned()) })
    }
}

pub unsafe fn get_u16_str(ustring: &UNICODE_STRING) -> &U16Str {
    // https://learn.microsoft.com/en-us/windows/win32/api/subauth/ns-subauth-unicode_string
    // UNICODE_STRING.Length is in bytes
    let u16_count = ustring.Length / 2;
    let chars: &[u16] = if u16_count == 0 {
        // If length is zero, we can't use slice::from_raw_parts as it requires a non-null pointer but
        // Buffer may be null in that case.
        &[]
    } else {
        // SAFETY: UNICODE_STRING.Buffer points to a valid u16 array of Length/2 elements
        unsafe { slice::from_raw_parts(ustring.Buffer, usize::from(u16_count)) }
    };
    U16CStr::from_slice_truncate(chars).map_or_else(|_| chars.into(), U16CStr::as_ustr)
}

pub unsafe fn get_path_name(handle: HANDLE) -> winsafe::SysResult<SmallVec<u16, MAX_PATH>> {
    let mut path = SmallVec::<u16, MAX_PATH>::new();
    // SAFETY: FFI call to GetFinalPathNameByHandleW to query the file path from a handle
    let len = unsafe {
        GetFinalPathNameByHandleW(
            handle,
            path.as_mut_ptr(),
            path.capacity().try_into().unwrap(),
            0, /*FILE_NAME_NORMALIZED*/
        )
    };
    if len == 0 {
        return Err(winsafe::GetLastError());
    }
    let len = usize::try_from(len).unwrap();
    if len <= path.capacity() {
        // SAFETY: GetFinalPathNameByHandleW wrote `len` u16 characters into the buffer
        unsafe { path.set_len(len) };
    } else {
        path.reserve_exact(len);
        // SAFETY: FFI call to GetFinalPathNameByHandleW with larger buffer after first call indicated needed size
        let len = unsafe {
            GetFinalPathNameByHandleW(
                handle,
                path.as_mut_ptr(),
                path.capacity().try_into().unwrap(),
                0, /*FILE_NAME_NORMALIZED*/
            )
        };
        let len = usize::try_from(len).unwrap();
        if len == 0 {
            return Err(winsafe::GetLastError());
        } else if len > path.capacity() {
            unreachable!()
        }
        // SAFETY: GetFinalPathNameByHandleW wrote `len` u16 characters into the buffer
        unsafe { path.set_len(len) };
    }
    Ok(path)
}

pub const fn access_mask_to_mode(desired_access: ACCESS_MASK) -> AccessMode {
    let has_write = (desired_access & (FILE_WRITE_DATA | FILE_APPEND_DATA | GENERIC_WRITE)) != 0;
    let has_read = (desired_access & (FILE_READ_DATA | GENERIC_READ)) != 0;
    if has_write {
        if has_read { AccessMode::READ.union(AccessMode::WRITE) } else { AccessMode::WRITE }
    } else {
        AccessMode::READ
    }
}

unsafe extern "system" {
    fn LocalFree(hmem: HLOCAL) -> HLOCAL;
    fn PathAllocCombine(
        pszpathin: PCWSTR,
        pszmore: PCWSTR,
        dwflags: ULONG,
        ppszpathout: *mut PWSTR,
    ) -> HRESULT;
}

pub struct HeapPath(PWSTR);
impl HeapPath {
    #[must_use]
    pub fn to_u16_str(&self) -> &U16Str {
        // SAFETY: the PWSTR was allocated by PathAllocCombine and is a valid null-terminated wide string
        unsafe { U16CStr::from_ptr_str(self.0).as_ustr() }
    }
}
impl Drop for HeapPath {
    fn drop(&mut self) {
        // SAFETY: freeing the PWSTR allocated by PathAllocCombine via LocalFree
        unsafe { LocalFree(self.0.cast()) };
    }
}

pub fn combine_paths(path1: &U16CStr, path2: &U16CStr) -> winsafe::SysResult<HeapPath> {
    const PATHCCH_ALLOW_LONG_PATHS: ULONG = 0x0000_0001;
    let mut out = std::ptr::null_mut();
    // SAFETY: FFI call to PathAllocCombine with valid null-terminated wide string pointers
    let hr = unsafe {
        PathAllocCombine(
            path1.as_ptr(),
            path2.as_ptr(),
            PATHCCH_ALLOW_LONG_PATHS, /*PATHCOMBINE_DEFAULT*/
            &raw mut out,
        )
    };
    if hr != S_OK {
        // SAFETY: creating an ERROR from the HRESULT value
        return Err(unsafe { co::ERROR::from_raw(hr.try_into().unwrap()) });
    }
    Ok(HeapPath(out))
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::OsString,
        fs::File,
        os::windows::{ffi::OsStringExt, io::AsRawHandle},
        path::PathBuf,
    };

    use super::get_path_name;

    fn test_get_path_name(filename: &str) {
        let tmpdir = tempfile::tempdir().unwrap();
        let path = tmpdir.path().canonicalize().unwrap().join(filename);
        let file = File::create(&path).unwrap();
        // SAFETY: passing a valid raw file handle to get_path_name
        let actual_path = unsafe { get_path_name(file.as_raw_handle().cast()) }.unwrap();
        let actual_path = PathBuf::from(OsString::from_wide(&actual_path));
        assert_eq!(path, actual_path);
    }

    #[test]
    fn test_get_path_name_short() {
        test_get_path_name("foo");
    }
    #[test]
    fn test_get_path_name_long() {
        test_get_path_name(str::repeat("a", 255).as_str());
    }

    #[test]
    fn test_combine_path() {
        use widestring::u16cstr;

        use super::combine_paths;

        let path1 = u16cstr!("C:\\foo");
        let path2 = u16cstr!("bar\\baz");
        let combined = combine_paths(path1, path2).unwrap();
        assert_eq!(combined.to_u16_str(), u16cstr!("C:\\foo\\bar\\baz"));
    }
}
