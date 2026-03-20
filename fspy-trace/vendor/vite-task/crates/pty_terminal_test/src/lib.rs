use std::io::{BufReader, Read};

pub use portable_pty::CommandBuilder;
use pty_terminal::terminal::{PtyReader, Terminal};
pub use pty_terminal::{
    ExitStatus,
    geo::ScreenSize,
    terminal::{ChildHandle, PtyWriter},
};

const MILESTONE_HYPERTEXT: char = '\u{200b}';

/// A test-oriented terminal that provides milestone-based synchronization.
///
/// Wraps a PTY terminal, splitting it into a [`PtyWriter`] for sending input
/// and a [`Reader`] that can wait for named milestones emitted by the child
/// process via [`pty_terminal_test_client::mark_milestone`].
pub struct TestTerminal {
    pub writer: PtyWriter,
    pub reader: Reader,
    pub child_handle: ChildHandle,
}

/// The read half of a test terminal, wrapping [`PtyReader`] with milestone support.
pub struct Reader {
    pty: BufReader<PtyReader>,
    child_handle: ChildHandle,
}

impl TestTerminal {
    /// Spawns a new child process in a test terminal.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY cannot be opened or the command fails to spawn.
    pub fn spawn(size: ScreenSize, cmd: CommandBuilder) -> anyhow::Result<Self> {
        let Terminal { pty_reader, pty_writer, child_handle, .. } = Terminal::spawn(size, cmd)?;
        Ok(Self {
            writer: pty_writer,
            reader: Reader { pty: BufReader::new(pty_reader), child_handle: child_handle.clone() },
            child_handle,
        })
    }
}

impl Reader {
    /// Returns terminal screen contents with milestone hyperlink text removed.
    #[must_use]
    pub fn screen_contents(&self) -> String {
        let mut contents = self.pty.get_ref().screen_contents();
        contents.retain(|ch| ch != MILESTONE_HYPERTEXT);
        contents
    }

    /// Reads from the PTY until a milestone with the given name is encountered.
    ///
    /// Returns the terminal screen contents at the moment the milestone is detected.
    ///
    /// Milestones use a uniform protocol across platforms: the milestone name
    /// is encoded in an OSC 8 hyperlink URI. We parse unhandled OSC sequences
    /// from the VT parser state (instead of raw byte matching), then decode the
    /// milestone URI payload. The zero-width milestone hyperlink anchor is
    /// stripped from returned screen contents.
    ///
    /// # Panics
    ///
    /// Panics if the child process exits (EOF) before the named milestone is received,
    /// or if a read error occurs.
    #[must_use]
    pub fn expect_milestone(&mut self, name: &str) -> String {
        let mut buf = [0u8; 4096];

        loop {
            let found = self
                .pty
                .get_ref()
                .take_unhandled_osc_sequences()
                .into_iter()
                .filter_map(|params| {
                    pty_terminal_test_client::decode_milestone_from_osc8_params(&params)
                })
                .any(|decoded| decoded == name);
            if found {
                return self.screen_contents();
            }

            let n = self.pty.read(&mut buf).expect("PTY read failed");
            assert!(n > 0, "EOF reached before milestone '{name}'");
        }
    }

    /// Reads all remaining PTY output until the child exits, then returns the exit status.
    ///
    /// # Errors
    ///
    /// Returns an error if waiting for the child process exit status fails.
    ///
    /// # Panics
    ///
    /// Panics if reading from the PTY fails.
    pub fn wait_for_exit(&mut self) -> anyhow::Result<ExitStatus> {
        let mut discard = Vec::new();
        self.pty.read_to_end(&mut discard).expect("PTY read_to_end failed");
        self.child_handle.wait()
    }
}
