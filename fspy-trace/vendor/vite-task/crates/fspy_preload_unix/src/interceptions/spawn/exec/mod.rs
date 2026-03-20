mod with_argv;

#[cfg(target_os = "linux")]
use std::ffi::CString;

use fspy_shared_unix::exec::ExecResolveConfig;
use libc::{c_char, c_int};
use with_argv::with_argv;

use crate::{
    client::{global_client, raw_exec::RawExec},
    macros::intercept,
};

#[cfg(target_os = "macos")]
pub unsafe fn environ() -> *const *const c_char {
    // SAFETY: _NSGetEnviron() always returns a valid pointer to the process's environ on macOS
    unsafe { *(libc::_NSGetEnviron().cast()) }
}

#[cfg(target_os = "linux")]
pub unsafe fn environ() -> *const *const c_char {
    unsafe extern "C" {
        static environ: *const *const c_char;
    }
    // SAFETY: environ is a valid global pointer to the process environment, as defined by POSIX
    unsafe { environ }
}

fn handle_exec(
    config: ExecResolveConfig,
    prog: *const libc::c_char,
    argv: *const *const libc::c_char,
    envp: *const *const libc::c_char,
) -> libc::c_int {
    let client =
        global_client().expect("exec unexpectedly called before client initialized in ctor");
    // SAFETY: prog, argv, and envp are valid pointers to C strings/arrays forwarded from the interposed exec function
    let result = unsafe {
        client.handle_exec(config, RawExec { prog, argv, envp }, |raw_command, pre_exec| {
            if let Some(pre_exec) = pre_exec {
                pre_exec.run()?;
            }
            Ok(execve::original()(raw_command.prog, raw_command.argv, raw_command.envp))
        })
    };
    match result {
        Ok(ret) => ret,
        Err(errno) => {
            errno.set();
            -1
        }
    }
}

intercept!(execve(64): unsafe extern "C" fn(
    prog: *const libc::c_char,
    argv: *const *const libc::c_char,
    envp: *const *const libc::c_char,
) -> libc::c_int);
unsafe extern "C" fn execve(
    prog: *const libc::c_char,
    argv: *const *const libc::c_char,
    envp: *const *const libc::c_char,
) -> libc::c_int {
    handle_exec(ExecResolveConfig::search_path_disabled(), prog, argv, envp)
}

intercept!(execl(64): unsafe extern "C" fn(path: *const c_char, arg0: *const c_char, ...) -> c_int);
unsafe extern "C" fn execl(path: *const c_char, arg0: *const c_char, valist: ...) -> c_int {
    #[expect(
        clippy::no_effect_underscore_binding,
        reason = "suppresses unused warning on *::original"
    )]
    let _unused = execl::original;
    // SAFETY: valist and arg0 are valid variadic arguments forwarded from the interposed execl function
    unsafe {
        with_argv(valist, arg0, |args, _remaining| {
            handle_exec(ExecResolveConfig::search_path_disabled(), path, args.as_ptr(), environ())
        })
    }
}

intercept!(execlp(64): unsafe extern "C" fn(path: *const c_char, arg0: *const c_char, ...) -> c_int);
unsafe extern "C" fn execlp(path: *const c_char, arg0: *const c_char, valist: ...) -> c_int {
    #[expect(
        clippy::no_effect_underscore_binding,
        reason = "suppresses unused warning on *::original"
    )]
    let _unused = execlp::original;
    // SAFETY: valist and arg0 are valid variadic arguments forwarded from the interposed execlp function
    unsafe {
        with_argv(valist, arg0, |args, _remaining| {
            handle_exec(
                ExecResolveConfig::search_path_enabled(None),
                path,
                args.as_ptr(),
                environ(),
            )
        })
    }
}

intercept!(execle(64): unsafe extern "C" fn(path: *const c_char, arg0: *const c_char, ...) -> c_int);
unsafe extern "C" fn execle(path: *const c_char, arg0: *const c_char, valist: ...) -> c_int {
    #[expect(
        clippy::no_effect_underscore_binding,
        reason = "suppresses unused warning on *::original"
    )]
    let _unused = execle::original;
    // SAFETY: valist and arg0 are valid variadic arguments forwarded from the interposed execle function
    unsafe {
        with_argv(valist, arg0, |args, mut remaining| {
            let envp = remaining.arg::<*const *const c_char>();
            handle_exec(ExecResolveConfig::search_path_disabled(), path, args.as_ptr(), envp)
        })
    }
}

intercept!(execv(64): unsafe extern "C" fn(path: *const c_char, argv: *const *const c_char) -> c_int);
unsafe extern "C" fn execv(path: *const c_char, argv: *const *const c_char) -> c_int {
    #[expect(
        clippy::no_effect_underscore_binding,
        reason = "suppresses unused warning on *::original"
    )]
    let _unused = execv::original;
    // SAFETY: path, argv are valid pointers forwarded from the interposed function; environ() returns the process environment
    unsafe { handle_exec(ExecResolveConfig::search_path_disabled(), path, argv, environ()) }
}

intercept!(execvp(64): unsafe extern "C" fn(
    prog: *const libc::c_char,
    argv: *const *const libc::c_char,
) -> c_int);
unsafe extern "C" fn execvp(prog: *const c_char, argv: *const *const c_char) -> c_int {
    #[expect(
        clippy::no_effect_underscore_binding,
        reason = "suppresses unused warning on *::original"
    )]
    let _unused = execvp::original;
    // SAFETY: environ() returns the valid process environment pointer
    handle_exec(ExecResolveConfig::search_path_enabled(None), prog, argv, unsafe { environ() })
}

#[cfg(target_os = "linux")]
mod linux_only {
    #[expect(
        clippy::useless_attribute,
        reason = "allow_attributes on use items is flagged as useless but needed here"
    )]
    #[expect(
        clippy::allow_attributes,
        reason = "using allow because wildcard_imports may or may not fire depending on build target"
    )]
    #[allow(
        clippy::wildcard_imports,
        reason = "macro-generated code requires types from parent scope"
    )]
    use super::*;
    use crate::client::convert::{PathAt, ToAbsolutePath};

    intercept!(execvpe(64): unsafe extern "C" fn(
        prog: *const libc::c_char,
        argv: *const *const libc::c_char,
        envp: *const *const libc::c_char,
    ) -> libc::c_int);
    unsafe extern "C" fn execvpe(
        file: *const c_char,
        argv: *const *const libc::c_char,
        envp: *const *const libc::c_char,
    ) -> c_int {
        #[expect(
            clippy::no_effect_underscore_binding,
            reason = "suppresses unused warning on *::original"
        )]
        let _unused = execvpe::original;
        handle_exec(ExecResolveConfig::search_path_enabled(None), file, argv, envp)
    }
    intercept!(execveat(64): unsafe extern "C" fn(
        dirfd: c_int,
        prog: *const libc::c_char,
        argv: *const *mut libc::c_char,
        envp: *const *mut libc::c_char,
        flags: c_int
    ) -> libc::c_int);
    unsafe extern "C" fn execveat(
        dirfd: c_int,
        pathname: *const libc::c_char,
        argv: *const *mut libc::c_char,
        envp: *const *mut libc::c_char,
        flags: c_int, // TODO: conform to semantics of flags
    ) -> libc::c_int {
        #[expect(
            clippy::no_effect_underscore_binding,
            reason = "suppresses unused warning on *::original"
        )]
        let _unused = execveat::original;
        // SAFETY: PathAt wraps a valid dirfd and pathname pointer from the interposed execveat call
        let abs_path_result = unsafe {
            PathAt(dirfd, pathname).to_absolute_path(|path| {
                let Some(path) = path else {
                    return Ok(None);
                };
                Ok(Some(CString::new(&**path).unwrap()))
            })
        };
        let abs_path = match abs_path_result {
            Ok(None) => {
                // SAFETY: forwarding the original arguments to the real execveat syscall
                return unsafe { execveat::original()(dirfd, pathname, argv, envp, flags) };
            }
            Ok(Some(path)) => path.as_ptr(),
            Err(errno) => {
                errno.set();
                return -1;
            }
        };
        handle_exec(ExecResolveConfig::search_path_disabled(), abs_path, argv.cast(), envp.cast())
    }

    intercept!(fexecve(64): unsafe extern "C" fn(
        fd: c_int,
        argv: *const *const libc::c_char,
        envp: *const *const libc::c_char,
    ) -> libc::c_int);
    unsafe extern "C" fn fexecve(
        fd: c_int,
        argv: *const *const libc::c_char,
        envp: *const *const libc::c_char,
    ) -> libc::c_int {
        #[expect(
            clippy::no_effect_underscore_binding,
            reason = "suppresses unused warning on *::original"
        )]
        let _unused = fexecve::original;
        let prog = format!("/proc/self/fd/{fd}\0");
        let prog = prog.as_ptr();
        handle_exec(ExecResolveConfig::search_path_disabled(), prog.cast(), argv, envp)
    }
}
