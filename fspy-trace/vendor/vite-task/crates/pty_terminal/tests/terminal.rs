use std::{
    io::{BufRead, BufReader, IsTerminal, Read, Write, stderr, stdin, stdout},
    time::{Duration, Instant},
};

use ntest::timeout;
use portable_pty::CommandBuilder;
use pty_terminal::{geo::ScreenSize, terminal::Terminal};
use subprocess_test::command_for_fn;

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn is_terminal() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        println!("{} {} {}", stdin().is_terminal(), stdout().is_terminal(), stderr().is_terminal());
    }));

    let Terminal { mut pty_reader, pty_writer: _pty_writer, child_handle, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();
    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();
    let _ = child_handle.wait().unwrap();
    let output = pty_reader.screen_contents();
    assert_eq!(output.trim(), "true true true");
}

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn write_basic_echo() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        use std::io::{BufRead, Write, stdin, stdout};
        let stdin = stdin();
        let mut stdout = stdout();
        let first_line = stdin.lock().lines().map_while(Result::ok).next();
        if let Some(line) = first_line {
            print!("{line}");
            stdout.flush().unwrap();
        }
    }));

    let Terminal { mut pty_reader, mut pty_writer, child_handle, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    pty_writer.write_line(b"hello world").unwrap();

    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();
    let _ = child_handle.wait().unwrap();

    let output = pty_reader.screen_contents();
    // PTY echoes the input, so we see "hello world\nhello world"
    assert_eq!(output.trim(), "hello world\nhello world");
}

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn write_multiple_lines() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        use std::io::{BufRead, Write, stdin, stdout};
        let stdin = stdin();
        let mut stdout = stdout();
        for line in stdin.lock().lines().map_while(Result::ok) {
            println!("Echo: {line}");
            stdout.flush().unwrap();
            if line == "third" {
                break;
            }
        }
    }));

    let Terminal { mut pty_reader, mut pty_writer, child_handle, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    pty_writer.write_line(b"first").unwrap();
    {
        let mut buf_reader = BufReader::new(&mut pty_reader);
        let mut line = Vec::new();
        // Read PTY echo of "first\n"
        buf_reader.read_until(b'\n', &mut line).unwrap();
        line.clear();
        // Read child response "Echo: first\n"
        buf_reader.read_until(b'\n', &mut line).unwrap();
    }

    pty_writer.write_line(b"second").unwrap();
    {
        let mut buf_reader = BufReader::new(&mut pty_reader);
        let mut line = Vec::new();
        buf_reader.read_until(b'\n', &mut line).unwrap();
        line.clear();
        buf_reader.read_until(b'\n', &mut line).unwrap();
    }

    pty_writer.write_line(b"third").unwrap();

    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();
    let _ = child_handle.wait().unwrap();

    let output = pty_reader.screen_contents();
    // PTY echoes input, then child prints "Echo: {line}\n" for each
    assert_eq!(output.trim(), "first\nEcho: first\nsecond\nEcho: second\nthird\nEcho: third");
}

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn write_after_exit() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        print!("exiting");
    }));

    let Terminal { mut pty_reader, mut pty_writer, child_handle, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    // Read all output - this blocks until child exits and EOF is reached
    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();
    let _ = child_handle.wait().unwrap();

    // Writer shutdown is done by a background thread after child wait returns.
    // Poll briefly for the writer state to flip to closed before asserting write failure.
    let deadline = Instant::now() + Duration::from_millis(300);
    while !pty_writer.is_closed() {
        assert!(Instant::now() <= deadline, "writer did not close after child exit");
        std::thread::yield_now();
    }

    let result = pty_writer.write_all(b"too late\n");
    assert!(result.is_err());
}

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn write_interactive_prompt() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        use std::io::{Write, stdin, stdout};
        let mut stdout = stdout();
        print!("Name: ");
        stdout.flush().unwrap();

        let mut input = std::string::String::new();
        stdin().read_line(&mut input).unwrap();
        print!("Hello, {}", input.trim());
        stdout.flush().unwrap();
    }));

    let Terminal { mut pty_reader, mut pty_writer, child_handle, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    // Wait for prompt "Name: " (read until the space after colon)
    {
        let mut buf_reader = BufReader::new(&mut pty_reader);
        let mut buf = Vec::new();
        buf_reader.read_until(b' ', &mut buf).unwrap();
        assert!(String::from_utf8_lossy(&buf).contains("Name:"));
    }

    // Send response
    pty_writer.write_line(b"Alice").unwrap();

    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();
    let _ = child_handle.wait().unwrap();

    let output = pty_reader.screen_contents();
    assert_eq!(output.trim(), "Name: Alice\nHello, Alice");
}

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn resize_terminal() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        use std::io::{Write, stdin, stdout};
        #[cfg(unix)]
        use std::sync::Arc;
        #[cfg(unix)]
        use std::sync::atomic::{AtomicBool, Ordering};

        // Cross-platform function to get terminal size
        fn get_size() -> (u16, u16) {
            if let Some((terminal_size::Width(w), terminal_size::Height(h))) =
                terminal_size::terminal_size()
            {
                (h, w)
            } else {
                (0, 0)
            }
        }

        #[cfg(unix)]
        let resized = Arc::new(AtomicBool::new(false));
        #[cfg(unix)]
        let resized_clone = Arc::clone(&resized);

        // Install SIGWINCH handler on Unix
        #[cfg(unix)]
        // SAFETY: The closure only performs an atomic store, which is signal-safe.
        unsafe {
            signal_hook::low_level::register(signal_hook::consts::SIGWINCH, move || {
                resized_clone.store(true, Ordering::SeqCst);
            })
            .unwrap();
        }

        // Print initial size
        let (rows, cols) = get_size();
        println!("initial: {rows} {cols}");
        stdout().flush().unwrap();

        // Wait for input to synchronize
        let mut input = std::string::String::new();
        stdin().read_line(&mut input).unwrap();

        // On Unix, check if resize signal was detected
        #[cfg(unix)]
        {
            if resized.load(Ordering::SeqCst) {
                println!("RESIZE_DETECTED");
            }
        }

        // On Windows, ConPTY resizes synchronously - detect by checking size change
        #[cfg(windows)]
        {
            let (new_rows, new_cols) = get_size();
            if (new_rows, new_cols) != (rows, cols) {
                println!("RESIZE_DETECTED");
            }
        }

        // Print new size
        let (rows, cols) = get_size();
        println!("resized: {rows} {cols}");
        stdout().flush().unwrap();
    }));

    let Terminal { mut pty_reader, mut pty_writer, child_handle: _, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    // Wait for initial size line (synchronize before resizing)
    {
        let mut buf_reader = BufReader::new(&mut pty_reader);
        let mut line = Vec::new();
        buf_reader.read_until(b'\n', &mut line).unwrap();
        assert!(String::from_utf8_lossy(&line).contains("initial: 80 80"));
    }

    // Perform resize
    pty_writer.resize(ScreenSize { rows: 40, cols: 40 }).unwrap();

    // Signal the process to continue and check resize
    pty_writer.write_line(b"").unwrap();

    // Read remaining output
    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();

    let output = pty_reader.screen_contents();
    // Verify resize was detected (SIGWINCH on Unix, synchronous on Windows)
    assert!(output.contains("RESIZE_DETECTED"));
    // Verify new size is correct
    assert!(output.contains("resized: 40 40"));
}

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn send_ctrl_c_interrupts_process() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        use std::io::{Write, stdout};

        // On Linux, use signalfd to wait for SIGINT without signal handlers or
        // background threads. This avoids musl issues where threads spawned during
        // .init_array (via ctor) are blocked by musl's internal lock.
        #[cfg(target_os = "linux")]
        {
            use nix::sys::{
                signal::{SigSet, Signal},
                signalfd::SignalFd,
            };

            // Block SIGINT so it goes to signalfd instead of the default handler.
            let mut mask = SigSet::empty();
            mask.add(Signal::SIGINT);
            mask.thread_block().unwrap();

            let sfd = SignalFd::new(&mask).unwrap();

            println!("ready");
            stdout().flush().unwrap();

            // Block until SIGINT arrives via signalfd.
            sfd.read_signal().unwrap().unwrap();
            print!("INTERRUPTED");
            stdout().flush().unwrap();
            std::process::exit(0);
        }

        // On macOS/Windows, use ctrlc which works fine (no .init_array/musl issue).
        #[cfg(not(target_os = "linux"))]
        {
            // On Windows, clear the "ignore CTRL_C" flag set by Rust runtime
            // so that CTRL_C_EVENT reaches the ctrlc handler.
            #[cfg(windows)]
            {
                // SAFETY: Declaring correct signature for SetConsoleCtrlHandler from kernel32.
                unsafe extern "system" {
                    fn SetConsoleCtrlHandler(
                        handler: Option<unsafe extern "system" fn(u32) -> i32>,
                        add: i32,
                    ) -> i32;
                }

                // SAFETY: Clearing the "ignore CTRL_C" flag so handlers are invoked.
                unsafe {
                    SetConsoleCtrlHandler(None, 0); // FALSE = remove ignore
                }
            }

            ctrlc::set_handler(move || {
                // Write directly and exit from the handler to avoid races.
                use std::io::Write;
                let _ = write!(std::io::stdout(), "INTERRUPTED");
                let _ = std::io::stdout().flush();
                std::process::exit(0);
            })
            .unwrap();

            println!("ready");
            stdout().flush().unwrap();

            // Block until Ctrl+C handler exits the process.
            loop {
                std::thread::park();
            }
        }
    }));

    let Terminal { mut pty_reader, mut pty_writer, child_handle: _, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();

    // Wait for process to be ready
    {
        let mut buf_reader = BufReader::new(&mut pty_reader);
        let mut line = Vec::new();
        buf_reader.read_until(b'\n', &mut line).unwrap();
        assert!(String::from_utf8_lossy(&line).contains("ready"));
    }

    // Send Ctrl+C
    pty_writer.send_ctrl_c().unwrap();

    // Read remaining output
    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();

    let output = pty_reader.screen_contents();
    // Verify interruption was detected
    assert!(output.contains("INTERRUPTED"));
}

#[test]
#[timeout(5000)]
#[expect(clippy::print_stdout, reason = "subprocess test output")]
fn read_to_end_returns_exit_status_success() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        println!("success");
    }));

    let Terminal { mut pty_reader, pty_writer: _pty_writer, child_handle, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();
    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();
    let status = child_handle.wait().unwrap();
    assert!(status.success());
    assert_eq!(status.exit_code(), 0);
}

#[test]
#[timeout(5000)]
fn read_to_end_returns_exit_status_nonzero() {
    let cmd = CommandBuilder::from(command_for_fn!((), |(): ()| {
        std::process::exit(42);
    }));

    let Terminal { mut pty_reader, pty_writer: _pty_writer, child_handle, .. } =
        Terminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd).unwrap();
    let mut discard = Vec::new();
    pty_reader.read_to_end(&mut discard).unwrap();
    let status = child_handle.wait().unwrap();
    assert!(!status.success());
    assert_eq!(status.exit_code(), 42);
}
