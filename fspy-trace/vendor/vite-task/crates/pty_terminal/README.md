# pty_terminal

A headless terminal emulator built on top of [portable-pty](https://crates.io/crates/portable-pty) and [vt100](https://crates.io/crates/vt100). It spawns child processes inside a pseudo-terminal (PTY) and provides an API for reading, writing, and resizing the terminal programmatically.

## Features

- Cross-platform PTY support (Unix and Windows via ConPTY)
- Built-in VT100 terminal emulation with screen state tracking
- Synchronous read-until pattern matching for interactive process control
- Terminal resize with proper signal delivery (SIGWINCH on Unix)
- Ctrl+C support via PTY input

## Usage

```rust
use pty_terminal::{geo::ScreenSize, terminal::{CommandBuilder, Terminal}};

let cmd = CommandBuilder::new("echo");
cmd.arg("hello");

let mut terminal = Terminal::spawn(ScreenSize { rows: 24, cols: 80 }, cmd)?;
terminal.read_until("hello")?;
let status = terminal.read_to_end()?;
assert!(status.success());
```
