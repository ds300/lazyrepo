use std::io::Write;

use ntest::timeout;
use portable_pty::CommandBuilder;
use pty_terminal::geo::ScreenSize;
use pty_terminal_test::TestTerminal;
use subprocess_test::command_for_fn;

#[test]
#[timeout(5000)]
fn milestone_raw_mode_keystrokes() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        use std::io::{Read, Write, stdout};

        // Enable raw mode (cross-platform via crossterm)
        crossterm::terminal::enable_raw_mode().unwrap();

        // Signal that raw mode is ready
        pty_terminal_test_client::mark_milestone("ready");

        let mut stdin = std::io::stdin();
        let mut stdout = stdout();
        let mut byte = [0u8; 1];

        loop {
            stdin.read_exact(&mut byte).unwrap();
            let ch = byte[0] as char;

            // Clear screen and print the keystroke at top-left
            write!(stdout, "\x1b[2J\x1b[H{ch}").unwrap();
            stdout.flush().unwrap();

            pty_terminal_test_client::mark_milestone("keystroke");

            if ch == 'q' {
                break;
            }
        }

        crossterm::terminal::disable_raw_mode().unwrap();
    }));

    let TestTerminal { mut writer, mut reader, child_handle: _ } =
        TestTerminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    // Wait for the subprocess to be ready
    let _ = reader.expect_milestone("ready");

    // Write 'a', expect keystroke, verify screen
    writer.write_all(b"a").unwrap();
    writer.flush().unwrap();
    let screen = reader.expect_milestone("keystroke");
    assert_eq!(screen.trim(), "a");

    // Write 'b', expect keystroke, verify screen
    writer.write_all(b"b").unwrap();
    writer.flush().unwrap();
    let screen = reader.expect_milestone("keystroke");
    assert_eq!(screen.trim(), "b");

    // Write 'c', expect keystroke, verify screen
    writer.write_all(b"c").unwrap();
    writer.flush().unwrap();
    let screen = reader.expect_milestone("keystroke");
    assert_eq!(screen.trim(), "c");

    // Write 'q' to quit and wait for the child to exit
    writer.write_all(b"q").unwrap();
    writer.flush().unwrap();
    let status = reader.wait_for_exit().unwrap();
    assert!(status.success());
}

/// Verifies that the non-visual milestone fence in `mark_milestone` does not
/// pollute `screen_contents()`. The subprocess appends characters without
/// clearing the screen, so any leftover space would appear between them.
#[test]
#[timeout(5000)]
fn milestone_does_not_pollute_screen() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        use std::io::{Read, Write, stdout};

        crossterm::terminal::enable_raw_mode().unwrap();
        pty_terminal_test_client::mark_milestone("ready");

        let mut stdin = std::io::stdin();
        let mut stdout = stdout();
        let mut byte = [0u8; 1];

        loop {
            stdin.read_exact(&mut byte).unwrap();
            let ch = byte[0] as char;

            // Append the character without clearing the screen
            write!(stdout, "{ch}").unwrap();
            stdout.flush().unwrap();

            pty_terminal_test_client::mark_milestone("keystroke");

            if ch == 'q' {
                break;
            }
        }

        crossterm::terminal::disable_raw_mode().unwrap();
    }));

    let TestTerminal { mut writer, mut reader, child_handle: _ } =
        TestTerminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    let _ = reader.expect_milestone("ready");

    writer.write_all(b"a").unwrap();
    writer.flush().unwrap();
    let screen = reader.expect_milestone("keystroke");
    assert_eq!(screen.trim(), "a");

    writer.write_all(b"b").unwrap();
    writer.flush().unwrap();
    let screen = reader.expect_milestone("keystroke");
    assert_eq!(screen.trim(), "ab");

    writer.write_all(b"q").unwrap();
    writer.flush().unwrap();
    let status = reader.wait_for_exit().unwrap();
    assert!(status.success());
}
