use allocator_api2::vec::Vec;
use bumpalo::Bump;

use crate::PathAccess;

#[ouroboros::self_referencing]
#[derive(Debug)]
pub struct PathAccessArena {
    pub bump: Bump,
    #[borrows(bump)]
    #[covariant]
    // TODO(pref): use linked list to avoid realloc & copy. We don't need random access.
    pub accesses: Vec<PathAccess<'this>, &'this Bump>,
}

impl Default for PathAccessArena {
    fn default() -> Self {
        Self::new(Bump::new(), |bump| Vec::new_in(bump))
    }
}

impl PathAccessArena {
    pub fn add(&mut self, access: PathAccess<'_>) {
        self.with_mut(|fields| {
            let path = access.path.clone_in(fields.bump);
            let path_access = PathAccess { mode: access.mode, path };
            fields.accesses.push(path_access);
        });
    }
}

#[expect(
    clippy::non_send_fields_in_send_ty,
    reason = "bump and accesses are safe to be sent across threads together"
)]
/// SAFETY: bump and accesses are safe to send together
unsafe impl Send for PathAccessArena {}
