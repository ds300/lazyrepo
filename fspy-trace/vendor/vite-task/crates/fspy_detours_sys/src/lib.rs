#![cfg(windows)]

#[expect(non_camel_case_types, non_snake_case, reason = "generated FFI bindings")]
#[expect(
    clippy::allow_attributes,
    reason = "can't use expect: wildcard_imports lint is unfulfilled in lib test mode"
)]
#[allow(clippy::wildcard_imports, reason = "generated FFI bindings use wildcard imports")]
#[rustfmt::skip] // generated code is formatted by prettyplease, not rustfmt
mod generated_bindings;

pub use generated_bindings::*;
