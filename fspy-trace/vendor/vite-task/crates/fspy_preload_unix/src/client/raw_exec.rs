use std::{ffi::CStr, ptr::null};

use bstr::{BStr, BString, ByteSlice};
use fspy_shared_unix::exec::Exec;

#[derive(Clone, Copy)]
pub struct RawExec {
    pub prog: *const libc::c_char,
    pub argv: *const *const libc::c_char,
    pub envp: *const *const libc::c_char,
}

impl RawExec {
    unsafe fn collect_c_str_array<T>(
        strs: *const *const libc::c_char,
        mut map_fn: impl FnMut(&BStr) -> T,
    ) -> Vec<T> {
        let mut count = 0usize;
        let mut cur_str = strs;
        // SAFETY: cur_str points into a valid null-terminated array of C string pointers (argv/envp convention)
        while !(unsafe { *cur_str }).is_null() {
            count += 1;
            // SAFETY: advancing within the bounds of the null-terminated pointer array
            cur_str = unsafe { cur_str.add(1) };
        }

        let mut str_vec = Vec::<T>::with_capacity(count);
        for i in 0..count {
            // SAFETY: i < count, so strs.add(i) is within the bounds of the pointer array
            let cur_str = unsafe { strs.add(i) };
            // SAFETY: *cur_str is a non-null pointer to a valid null-terminated C string (verified by the counting loop above)
            str_vec.push(map_fn(unsafe { CStr::from_ptr(*cur_str) }.to_bytes().as_bstr()));
        }
        str_vec
    }

    pub fn to_c_str<R>(mut s: BString, f: impl FnOnce(*const libc::c_char) -> R) -> R {
        s.push(0);
        f(s.as_ptr().cast())
    }

    fn to_c_str_array<R>(
        mut strs: Vec<BString>,
        f: impl FnOnce(*const *const libc::c_char) -> R,
    ) -> R {
        let mut ptr_vec = Vec::<*const libc::c_char>::with_capacity(strs.len() + 1);
        for s in &mut strs {
            s.push(0);
            ptr_vec.push(s.as_ptr().cast());
        }
        ptr_vec.push(null());
        f(ptr_vec.as_ptr())
    }

    pub unsafe fn to_exec(self) -> Exec {
        // SAFETY: self.prog is a non-null pointer to a valid null-terminated C string, as guaranteed by the libc exec calling convention
        let program = unsafe { CStr::from_ptr(self.prog) }.to_bytes().as_bstr().to_owned();

        // SAFETY: self.argv is a valid null-terminated array of C string pointers, as guaranteed by the libc exec calling convention
        let args = unsafe { Self::collect_c_str_array(self.argv, BStr::to_owned) };

        // SAFETY: self.envp is a valid null-terminated array of C string pointers, as guaranteed by the libc exec calling convention
        let envs = unsafe {
            Self::collect_c_str_array(self.envp, |env| {
                env.iter().position(|b| *b == b'=').map_or_else(
                    || (env.to_owned(), None),
                    |eq_pos| (env[..eq_pos].to_owned(), Some(env[(eq_pos + 1)..].to_owned())),
                )
            })
        };

        Exec { program, args, envs }
    }

    pub fn from_exec<R>(cmd: Exec, f: impl FnOnce(Self) -> R) -> R {
        let envs: Vec<BString> = cmd
            .envs
            .into_iter()
            .map(|(name, value)| {
                let mut env = name;
                if let Some(value) = value {
                    env.push(b'=');
                    env.extend_from_slice(&value);
                }
                env
            })
            .collect();

        Self::to_c_str(cmd.program, |prog| {
            Self::to_c_str_array(cmd.args, |argv| {
                Self::to_c_str_array(envs, |envp| f(Self { prog, argv, envp }))
            })
        })
    }
}
