use std::{
    alloc::{self, Layout},
    cmp::max,
    ops::Deref,
    ptr::NonNull,
    sync::LazyLock,
};

use super::get_notif_sizes;

#[derive(Debug)]
struct BufSizes {
    req_layout: Layout,
    resp_layout: Layout,
}

static BUF_SIZES: LazyLock<BufSizes> = LazyLock::new(|| {
    const MAX_ALIGN: usize = align_of::<libc::max_align_t>();

    let sizes = get_notif_sizes().unwrap();
    BufSizes {
        req_layout: Layout::from_size_align(
            max(sizes.seccomp_notif.into(), size_of::<libc::seccomp_notif>()),
            MAX_ALIGN,
        )
        .unwrap(),
        resp_layout: Layout::from_size_align(
            max(sizes.seccomp_notif_resp.into(), size_of::<libc::seccomp_notif_resp>()),
            MAX_ALIGN,
        )
        .unwrap(),
    }
});

pub struct Alloced<T> {
    ptr: NonNull<T>,
    layout: Layout,
}

impl<T> Alloced<T> {
    /// Allocates a zero-initialized buffer with the given layout.
    ///
    /// # Safety
    /// The `layout` must have a size large enough to hold a value of type `T` and
    /// must have proper alignment for `T`.
    pub(crate) unsafe fn alloc(layout: Layout) -> Self {
        // SAFETY: layout is non-zero-sized (guaranteed by caller) and properly aligned
        let ptr = unsafe { alloc::alloc_zeroed(layout) };

        let ptr = NonNull::new(ptr).unwrap();
        Self { ptr: ptr.cast(), layout }
    }

    pub(crate) const fn zeroed(&mut self) -> &mut T {
        // SAFETY: `self.ptr` was allocated with `self.layout.size()` bytes,
        // so writing that many zero bytes is within bounds
        unsafe { self.ptr.cast::<u8>().write_bytes(0, self.layout.size()) };
        // SAFETY: the pointer is valid, properly aligned, and the buffer has just
        // been zero-initialized, which is valid for the kernel structs used here
        unsafe { self.ptr.as_mut() }
    }
}

impl<T> Deref for Alloced<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        // SAFETY: the pointer is valid and properly aligned, allocated in `alloc()`
        unsafe { self.ptr.as_ref() }
    }
}

impl<T> Drop for Alloced<T> {
    fn drop(&mut self) {
        // SAFETY: `self.ptr` was allocated with `alloc::alloc_zeroed` using `self.layout`,
        // so it is safe to deallocate with the same layout
        unsafe {
            alloc::dealloc(self.ptr.as_ptr().cast(), self.layout);
        }
    }
}

// SAFETY: `Alloced<T>` owns a heap allocation and does not use thread-local storage.
// It is safe to send across threads when `T` itself is `Send + Sync`.
unsafe impl<T: Send + Sync> Send for Alloced<T> {}
// SAFETY: `Alloced<T>` only provides shared access via `Deref`, which is safe
// when `T` is `Send + Sync`.
unsafe impl<T: Send + Sync> Sync for Alloced<T> {}

/// Allocates a zero-initialized buffer for a `seccomp_notif` struct, sized to at least
/// what the kernel requires.
#[must_use]
pub fn alloc_seccomp_notif() -> Alloced<libc::seccomp_notif> {
    // SAFETY: `BUF_SIZES.req_layout` is computed from `get_notif_sizes()` and
    // `size_of::<seccomp_notif>()`, guaranteeing sufficient size and alignment
    unsafe { Alloced::alloc(BUF_SIZES.req_layout) }
}

/// Allocates a zero-initialized buffer for a `seccomp_notif_resp` struct, sized to at least
/// what the kernel requires.
#[must_use]
pub fn alloc_seccomp_notif_resp() -> Alloced<libc::seccomp_notif_resp> {
    // SAFETY: `BUF_SIZES.resp_layout` is computed from `get_notif_sizes()` and
    // `size_of::<seccomp_notif_resp>()`, guaranteeing sufficient size and alignment
    unsafe { Alloced::alloc(BUF_SIZES.resp_layout) }
}
