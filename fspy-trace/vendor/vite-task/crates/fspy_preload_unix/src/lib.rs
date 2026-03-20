// On musl targets, fspy_preload_unix is not needed since we can track accesses via seccomp-only.
// Compile as an empty crate to avoid build failures from missing libc symbols.
#![cfg_attr(not(target_env = "musl"), feature(c_variadic))]

#[cfg(all(unix, not(target_env = "musl")))]
mod client;
#[cfg(all(unix, not(target_env = "musl")))]
mod interceptions;
#[cfg(all(unix, not(target_env = "musl")))]
mod libc;
#[cfg(all(unix, not(target_env = "musl")))]
mod macros;
