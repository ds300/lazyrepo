# pty_terminal_test

`pty_terminal_test` is a thin test helper on top of `pty_terminal` for writing
integration tests against interactive CLI processes.

It provides:

- `TestTerminal::spawn(...)` to start a child process in a PTY.
- `writer` (`PtyWriter`) to send input to the child.
- `reader` (`Reader`) to wait for milestones and collect final exit status.

## Why this crate exists

Reading raw PTY bytes is often not enough for deterministic interactive tests.
You usually need explicit synchronization points from the child process.

This crate solves that by pairing:

- `pty_terminal_test_client::mark_milestone("name")` in the child process, and
- `reader.expect_milestone("name")` in the test process.

## Core API

```rust
use portable_pty::CommandBuilder;
use pty_terminal::geo::ScreenSize;
use pty_terminal_test::TestTerminal;

let cmd = CommandBuilder::from("your-binary-or-subprocess-test-command");
let TestTerminal { mut writer, mut reader, child_handle: _ } =
    TestTerminal::spawn(ScreenSize { rows: 80, cols: 80 }, cmd)?;

// Wait until child reaches a known point.
let _screen = reader.expect_milestone("ready");

// Interact with child.
writer.write_all(b"q")?;
writer.flush()?;

// Wait for completion.
let status = reader.wait_for_exit();
assert!(status.success());
# Ok::<(), Box<dyn std::error::Error>>(())
```

## Milestone protocol

Milestones are encoded as an OSC 8 hyperlink:

- open: `ESC ] 8 ; ; https://milestone.invalid/<hex(name)> ESC \`
- hypertext: zero-width space (`U+200B`)
- close: `ESC ] 8 ; ; ESC \`

`Reader::expect_milestone` works like this:

1. Drain parsed unhandled OSC sequences from `PtyReader`.
2. Decode OSC 8 URI payload back into milestone name.
3. If no match yet, continue reading from PTY and repeat.
4. On match, return current `screen_contents()`.

The helper strips the protocol's zero-width space from returned screen text.

## Cross-platform behavior

The OSC 8 + zero-width anchor approach is used because it works across Unix and
Windows ConPTY in this project. In particular, zero-length hyperlink opens can
be lost on some Windows output paths, so the zero-width anchor is intentional.

## Typical test pattern

In the child process:

```rust
pty_terminal_test_client::mark_milestone("ready");
// do work...
pty_terminal_test_client::mark_milestone("after-input");
```

In the parent test:

```rust
let _ = reader.expect_milestone("ready");
writer.write_all(b"input")?;
writer.flush()?;
let screen = reader.expect_milestone("after-input");
```
