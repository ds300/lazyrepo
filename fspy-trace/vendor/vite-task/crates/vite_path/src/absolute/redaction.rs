use std::sync::Arc;

use super::AbsolutePath;

thread_local! {
    pub(crate) static REDACTION_PREFIX: std::cell::RefCell<Option<Arc<AbsolutePath>>> = const { std::cell::RefCell::new(None) };
}

#[derive(Debug)]
pub struct RedactionGuard(());

impl Drop for RedactionGuard {
    fn drop(&mut self) {
        REDACTION_PREFIX.set(None);
    }
}

/// # Panics
/// Panics if a `RedactionGuard` is already active.
#[must_use]
pub fn redact_absolute_paths(prefix: &Arc<AbsolutePath>) -> RedactionGuard {
    REDACTION_PREFIX.with(|redaction_prefix| {
        let mut redaction_prefix = redaction_prefix.borrow_mut();
        assert!(redaction_prefix.is_none(), "RedactionGuard already active");
        *redaction_prefix = Some(Arc::clone(prefix));
    });
    RedactionGuard(())
}
