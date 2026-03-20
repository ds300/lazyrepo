use std::{
    collections::VecDeque,
    io::{Read, Write},
    sync::{Arc, Mutex, OnceLock},
    thread,
};

pub use portable_pty::CommandBuilder;
use portable_pty::{ChildKiller, ExitStatus, MasterPty};

use crate::geo::ScreenSize;

type ChildWaitResult = Result<ExitStatus, Arc<std::io::Error>>;

/// The read half of a PTY connection. Implements [`Read`].
///
/// Reading feeds data through an internal vt100 parser (shared with [`PtyWriter`]),
/// keeping `screen_contents()` up-to-date with parsed terminal output.
pub struct PtyReader {
    reader: Box<dyn Read + Send>,
    parser: Arc<Mutex<vt100::Parser<Vt100Callbacks>>>,
}

/// The write half of a PTY connection. Implements [`Write`].
///
/// The writer is shared with `Vt100Callbacks` (for DSR query responses) and the
/// background child-monitoring thread (which sets it to `None` on child exit).
pub struct PtyWriter {
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    parser: Arc<Mutex<vt100::Parser<Vt100Callbacks>>>,
    master: Box<dyn MasterPty + Send>,
}

/// A cloneable handle to a child process spawned in a PTY.
pub struct ChildHandle {
    child_killer: Box<dyn ChildKiller + Send + Sync>,
    exit_status: Arc<OnceLock<ChildWaitResult>>,
}

impl Clone for ChildHandle {
    fn clone(&self) -> Self {
        Self {
            child_killer: self.child_killer.clone_killer(),
            exit_status: Arc::clone(&self.exit_status),
        }
    }
}

/// A headless terminal consisting of a PTY reader, writer, and a child process handle.
pub struct Terminal {
    pub pty_reader: PtyReader,
    pub pty_writer: PtyWriter,
    pub child_handle: ChildHandle,
}

struct Vt100Callbacks {
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    unhandled_osc_sequences: VecDeque<Vec<Vec<u8>>>,
}

impl vt100::Callbacks for Vt100Callbacks {
    fn unhandled_osc(&mut self, _screen: &mut vt100::Screen, params: &[&[u8]]) {
        let owned: Vec<Vec<u8>> = params.iter().map(|p| p.to_vec()).collect();
        self.unhandled_osc_sequences.push_back(owned);
    }

    fn unhandled_csi(
        &mut self,
        screen: &mut vt100::Screen,
        i1: Option<u8>,
        i2: Option<u8>,
        params: &[&[u16]],
        c: char,
    ) {
        // CSI 6 n = Device Status Report (cursor position query)
        // Response: ESC [ Pl ; Pc R
        if let Some(&[6]) = params.first()
            && i1.is_none()
            && i2.is_none()
            && c == 'n'
        {
            let (row, col) = screen.cursor_position();
            let response = format!("\x1b[{};{}R", row + 1, col + 1);
            if let Some(writer) = self.writer.lock().unwrap().as_mut() {
                let _ = writer.write_all(response.as_bytes());
            }
        }
    }
}

impl Read for PtyReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.reader.read(buf)?;
        if n > 0 {
            self.parser.lock().unwrap().process(&buf[..n]);
        }
        Ok(n)
    }
}

impl Write for PtyWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut guard =
            self.writer.lock().map_err(|e| std::io::Error::other(format!("Poisoned lock: {e}")))?;

        guard.as_mut().map_or_else(
            || Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "Child process has exited")),
            |writer| writer.write(buf),
        )
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let mut guard =
            self.writer.lock().map_err(|e| std::io::Error::other(format!("Poisoned lock: {e}")))?;

        guard.as_mut().map_or(Ok(()), Write::flush)
    }
}

impl PtyReader {
    /// Returns the current terminal screen contents as a string (parsed by the vt100 emulator).
    ///
    /// # Panics
    ///
    /// Panics if the parser lock is poisoned.
    #[must_use]
    pub fn screen_contents(&self) -> String {
        self.parser.lock().unwrap().screen().contents()
    }

    /// Drains and returns all unhandled OSC sequences received since the last call.
    ///
    /// Each entry is a list of byte-vector parameters from a single OSC sequence
    /// (`ESC ] param1 ; param2 ; ... ST`).
    ///
    /// # Panics
    ///
    /// Panics if the parser lock is poisoned.
    #[must_use]
    pub fn take_unhandled_osc_sequences(&self) -> VecDeque<Vec<Vec<u8>>> {
        std::mem::take(&mut self.parser.lock().unwrap().callbacks_mut().unhandled_osc_sequences)
    }

    /// Returns the current cursor position as `(row, col)`, both 0-indexed.
    ///
    /// # Panics
    ///
    /// Panics if the parser lock is poisoned.
    #[must_use]
    pub fn cursor_position(&self) -> (u16, u16) {
        self.parser.lock().unwrap().screen().cursor_position()
    }
}

impl PtyWriter {
    /// Returns `true` if the child process write channel has been closed.
    ///
    /// # Panics
    ///
    /// Panics if the writer lock is poisoned.
    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.writer.lock().unwrap().is_none()
    }

    /// Writes `line` followed by a platform-appropriate line ending to the child process.
    ///
    /// On Unix, appends `\n`. On Windows `ConPTY`, appends `\r\n` for proper line handling.
    ///
    /// # Errors
    ///
    /// Returns an error if the child process has exited or writing fails.
    pub fn write_line(&mut self, line: &[u8]) -> std::io::Result<()> {
        self.write_all(line)?;

        #[cfg(not(target_os = "windows"))]
        self.write_all(b"\n")?;

        #[cfg(target_os = "windows")]
        self.write_all(b"\r\n")?;

        self.flush()
    }

    /// Sends Ctrl+C (SIGINT) to the child process.
    ///
    /// Writes ETX (0x03) to the PTY. On Unix, the terminal driver converts this
    /// to SIGINT for the child's process group. On Windows, `ConPTY` intercepts
    /// the byte and generates `CTRL_C_EVENT` for the child.
    ///
    /// # Errors
    ///
    /// Returns an error if the child process has already exited or writing fails.
    pub fn send_ctrl_c(&mut self) -> std::io::Result<()> {
        self.write_all(&[0x03])?;
        self.flush()
    }

    /// Resizes the terminal to the given size.
    ///
    /// On Unix, delivers SIGWINCH to the child process. On Windows, `ConPTY` resizes synchronously.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY cannot be resized.
    ///
    /// # Panics
    ///
    /// Panics if the parser lock is poisoned.
    pub fn resize(&self, size: ScreenSize) -> anyhow::Result<()> {
        self.master.resize(portable_pty::PtySize {
            rows: size.rows,
            cols: size.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        self.parser.lock().unwrap().screen_mut().set_size(size.rows, size.cols);

        Ok(())
    }
}

impl ChildHandle {
    /// Blocks until the child process has exited and returns its exit status.
    ///
    /// # Errors
    ///
    /// Returns an error if waiting for the child process exit status fails.
    pub fn wait(&self) -> anyhow::Result<ExitStatus> {
        match self.exit_status.wait() {
            Ok(status) => Ok(status.clone()),
            Err(error) => Err(anyhow::Error::new(Arc::clone(error))),
        }
    }

    /// Kills the child process.
    ///
    /// # Errors
    ///
    /// Returns an error if the child process cannot be killed.
    pub fn kill(&mut self) -> anyhow::Result<()> {
        self.child_killer.kill()?;
        Ok(())
    }
}

impl Terminal {
    /// Spawns a new child process in a headless terminal with the given size and command.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY cannot be opened or the command fails to spawn.
    ///
    /// # Panics
    ///
    /// Panics if the writer lock is poisoned when the background thread closes it.
    pub fn spawn(size: ScreenSize, cmd: CommandBuilder) -> anyhow::Result<Self> {
        // On musl libc (Alpine Linux), concurrent PTY operations trigger
        // SIGSEGV/SIGBUS in musl internals (sysconf, fcntl). This affects
        // both openpty+fork and FD cleanup (close) from background threads.
        // Serialize all PTY lifecycle operations that touch musl internals.
        #[cfg(target_env = "musl")]
        static PTY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        #[cfg(target_env = "musl")]
        let _spawn_guard = PTY_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let pty_pair = portable_pty::native_pty_system().openpty(portable_pty::PtySize {
            rows: size.rows,
            cols: size.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        // Create reader BEFORE spawning child to ensure it's ready for data
        let reader = pty_pair.master.try_clone_reader()?;
        let writer: Arc<Mutex<Option<Box<dyn Write + Send>>>> =
            Arc::new(Mutex::new(Some(pty_pair.master.take_writer()?)));
        let mut child = pty_pair.slave.spawn_command(cmd)?;
        let child_killer = child.clone_killer();
        let master = pty_pair.master;
        let exit_status: Arc<OnceLock<ChildWaitResult>> = Arc::new(OnceLock::new());

        // Background thread: wait for child to exit, then clean up.
        //
        // The slave is kept alive until after `child.wait()` returns rather than
        // being dropped immediately after spawn. On macOS, if the parent's slave
        // fd is closed early (before spawn) and the child exits quickly, ALL
        // slave references close before the reader issues its first `read()`.
        // macOS then returns EIO on the master without draining the output buffer,
        // causing data loss. Holding the slave until the background thread takes
        // over guarantees the PTY stays connected while the child runs.
        thread::spawn({
            let writer = Arc::clone(&writer);
            let exit_status = Arc::clone(&exit_status);
            let slave = pty_pair.slave;
            move || {
                let _ = exit_status.set(child.wait().map_err(Arc::new));
                // On musl, serialize FD cleanup (close) with PTY spawn to
                // prevent racing on musl-internal state.
                #[cfg(target_env = "musl")]
                let _cleanup_guard = PTY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
                // Close writer first, then drop slave to trigger EOF on the reader.
                *writer.lock().unwrap() = None;
                drop(slave);
            }
        });

        let parser = Arc::new(Mutex::new(vt100::Parser::new_with_callbacks(
            size.rows,
            size.cols,
            0,
            Vt100Callbacks {
                writer: Arc::clone(&writer),
                unhandled_osc_sequences: VecDeque::new(),
            },
        )));

        Ok(Self {
            pty_reader: PtyReader { reader, parser: Arc::clone(&parser) },
            pty_writer: PtyWriter { writer, parser, master },
            child_handle: ChildHandle { child_killer, exit_status },
        })
    }
}
