pub mod arg;

use std::io;

use libc::seccomp_notif;

#[expect(clippy::module_name_repetitions, reason = "clearer as a standalone export")]
pub trait SeccompNotifyHandler {
    fn syscalls() -> &'static [syscalls::Sysno];
    /// Handles a seccomp notification for an intercepted syscall.
    ///
    /// # Errors
    /// Returns an error if the handler fails to process the notification.
    fn handle_notify(&mut self, notify: &seccomp_notif) -> io::Result<()>;
}

#[doc(hidden)] // Re-export for use in the macro
pub use syscalls::Sysno;

#[macro_export]
macro_rules! impl_handler {
    ($type:ty: $(
        $(#[$attr:meta])?
        $syscall:ident,
    )* ) => {

    impl $crate::supervisor::handler::SeccompNotifyHandler for $type {
        fn syscalls() -> &'static [$crate::supervisor::handler::Sysno] {
            &[ $(
                $(#[$attr])?
                $crate::supervisor::handler::Sysno::$syscall
            ),* ]
        }
        fn handle_notify(&mut self, notify: &::libc::seccomp_notif) -> ::std::io::Result<()> {
            $crate::supervisor::handler::arg::Caller::with_pid(notify.pid as _, |caller| {
                $(
                    $(#[$attr])?
                    if notify.data.nr == $crate::supervisor::handler::Sysno::$syscall as _ {
                        return self.$syscall(caller, $crate::supervisor::handler::arg::FromNotify::from_notify(notify)?)
                    }
                )*
                Ok(())
            })
        }
    }
    };
}
