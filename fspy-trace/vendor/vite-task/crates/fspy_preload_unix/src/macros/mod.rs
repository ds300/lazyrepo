#[cfg(target_os = "macos")]
#[path = "./macos.rs"]
mod os_impl;

#[cfg(target_os = "linux")]
#[path = "./linux.rs"]
mod os_impl;

#[expect(
    clippy::redundant_pub_crate,
    reason = "macro_rules! macros cannot be `pub`, only `pub(crate)` at most"
)]
pub(crate) use os_impl::*;
