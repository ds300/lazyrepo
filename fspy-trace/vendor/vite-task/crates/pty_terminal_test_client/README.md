# pty_terminal_test_client

`pty_terminal_test_client` is the child-side helper used with
`pty_terminal_test`.

It provides `mark_milestone("name")`, which emits milestone markers from the
subprocess so the parent test can synchronize on them.

Reader-side behavior and protocol details are documented in:

- `crates/pty_terminal_test/README.md`
