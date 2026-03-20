pub mod channel;
mod native_path;
pub(crate) mod native_str;

use std::fmt::Debug;

use bincode::{BorrowDecode, Encode, config::Configuration};
use bitflags::bitflags;
pub use native_path::NativePath;
pub use native_str::NativeStr;

pub const BINCODE_CONFIG: Configuration = bincode::config::standard();

#[derive(Encode, BorrowDecode, PartialEq, Eq, PartialOrd, Ord, Hash, Clone, Copy)]
pub struct AccessMode(u8);

bitflags! {
    impl AccessMode: u8 {
        const READ = 1;
        const WRITE = 1 << 1;
        const READ_DIR = 1 << 2;
    }
}

impl Debug for AccessMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        struct InternalAccessMode(AccessMode);
        impl Debug for InternalAccessMode {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                bitflags::parser::to_writer(&self.0, f)
            }
        }
        f.debug_tuple("AccessMode").field(&InternalAccessMode(*self)).finish()
    }
}

#[derive(Encode, BorrowDecode, Debug, Clone, Copy, PartialEq, Eq)]
pub struct PathAccess<'a> {
    pub mode: AccessMode,
    pub path: &'a NativePath,
    // TODO: add follow_symlinks (O_NOFOLLOW)
}

impl<'a> PathAccess<'a> {
    pub fn read(path: impl Into<&'a NativePath>) -> Self {
        Self { mode: AccessMode::READ, path: path.into() }
    }

    pub fn read_dir(path: impl Into<&'a NativePath>) -> Self {
        Self { mode: AccessMode::READ_DIR, path: path.into() }
    }
}
