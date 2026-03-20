use std::os::raw::c_void;

// $crate::macros::
macro_rules! intercept {
    ($name: ident $((64))? : $fn_sig: ty) => {
        const _: () = {
            const _: $fn_sig = $name;
            const _: $fn_sig = $crate::libc::$name;

            #[used]
            #[unsafe(link_section = "__DATA,__interpose")]
            static mut _INTERPOSE_ENTRY: $crate::macros::InterposeEntry =
                $crate::macros::InterposeEntry { _new: $name as _, _old: $crate::libc::$name as _ };
        };

        mod $name {
            // macro-generated: imports may or may not be used depending on expansion context
            #[expect(clippy::allow_attributes, reason = "macro-generated: imports may or may not be used depending on expansion context")]
            #[allow(unused_imports, reason = "macro-generated: imports may or may not be used depending on expansion context")]
            use super::*;
            pub fn original() -> $fn_sig {
                $crate::libc::$name
            }
        }
    };
}

pub(crate) use intercept;

#[doc(hidden)]
#[repr(C)]
pub struct InterposeEntry {
    pub _new: *const c_void,
    pub _old: *const c_void,
}
