pub mod handler;
mod listener;

use std::{
    convert::Infallible,
    io::{self},
    os::{
        fd::{FromRawFd, OwnedFd},
        unix::ffi::OsStrExt,
    },
};

use futures_util::{
    future::{Either, select},
    pin_mut,
};
pub use handler::SeccompNotifyHandler;
use listener::NotifyListener;
use passfd::tokio::FdPassingExt;
use seccompiler::{BpfProgram, SeccompAction, SeccompFilter};
use tokio::{
    net::UnixListener,
    sync::oneshot,
    task::{JoinHandle, JoinSet},
};
use tracing::{Level, span};

use crate::{
    bindings::alloc::alloc_seccomp_notif_resp,
    payload::{Filter, SeccompPayload},
};

pub struct Supervisor<H> {
    payload: SeccompPayload,
    cancel_tx: oneshot::Sender<Infallible>,
    handling_loop_task: JoinHandle<io::Result<Vec<H>>>,
}

impl<H> Supervisor<H> {
    #[must_use]
    pub const fn payload(&self) -> &SeccompPayload {
        &self.payload
    }

    /// Stops the supervisor and returns all handler instances.
    ///
    /// # Panics
    /// Panics if the handling loop task has panicked.
    ///
    /// # Errors
    /// Returns an error if any of the spawned handler tasks failed with an I/O error.
    pub async fn stop(self) -> io::Result<Vec<H>> {
        drop(self.cancel_tx);
        self.handling_loop_task.await.expect("handling loop task panicked")
    }
}

/// Creates a new supervisor that listens for seccomp user notifications.
///
/// # Panics
/// Panics if the seccomp filter cannot be compiled or the target architecture is unsupported.
///
/// # Errors
/// Returns an error if the temporary IPC socket cannot be created.
pub fn supervise<H: SeccompNotifyHandler + Default + Send + 'static>() -> io::Result<Supervisor<H>>
{
    let notify_listener = tempfile::Builder::new()
        .prefix("fspy_seccomp_notify")
        .make(|path| UnixListener::bind(path))?;

    let seccomp_filter = SeccompFilter::new(
        H::syscalls().iter().map(|sysno| (sysno.id().into(), vec![])).collect(),
        SeccompAction::Allow,
        SeccompAction::Raw(libc::SECCOMP_RET_USER_NOTIF),
        std::env::consts::ARCH.try_into().unwrap(),
    )
    .unwrap();

    let bpf_filter =
        Filter(BpfProgram::try_from(seccomp_filter).unwrap().into_iter().map(Into::into).collect());

    let payload = SeccompPayload {
        ipc_path: notify_listener.path().as_os_str().as_bytes().to_vec(),
        filter: bpf_filter,
    };

    // The oneshot channel is used to cancel the accept loop.
    // The sender doesn't need to actually send anything. Drop is enough.
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<Infallible>();

    let handling_loop = async move {
        let mut join_set: JoinSet<io::Result<H>> = JoinSet::new();

        loop {
            let accept_future = notify_listener.as_file().accept();
            pin_mut!(accept_future);
            let (incoming_stream, _) = match select(&mut cancel_rx, accept_future).await {
                Either::Left((Err(_), _)) => break,
                Either::Right((incoming, _)) => incoming?,
            };
            let notify_fd = incoming_stream.recv_fd().await?;
            // SAFETY: `recv_fd` returns a valid file descriptor received via
            // Unix domain socket fd passing
            let notify_fd = unsafe { OwnedFd::from_raw_fd(notify_fd) };
            let mut listener = NotifyListener::try_from(notify_fd)?;

            let mut handler = H::default();
            let mut resp_buf = alloc_seccomp_notif_resp();

            join_set.spawn(async move {
                while let Some(notify) = listener.next().await? {
                    let _span = span!(Level::TRACE, "notify loop tick");
                    // Errors on the supervisor side could be caused by a target process aborting.
                    // It shouldn't break the syscall handling loop as there might be target processes.
                    let _handle_result = handler.handle_notify(notify);
                    let req_id = notify.id;
                    listener.send_continue(req_id, &mut resp_buf)?;
                }
                io::Result::Ok(handler)
            });
        }
        let mut handlers = Vec::<H>::new();
        while let Some(handler) = join_set.join_next().await.transpose()? {
            handlers.push(handler?);
        }
        Ok(handlers)
    };
    Ok(Supervisor { payload, cancel_tx, handling_loop_task: tokio::spawn(handling_loop) })
}
