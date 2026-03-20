# E2E Snapshot Tests

End-to-end tests that execute the `vp` binary and verify its output.

## When to add tests here

- Testing CLI behavior and output formatting
- Testing cache hit/miss behavior across multiple command invocations
- Testing error messages shown to users
- Testing integration between multiple commands in sequence

## How it works

Each fixture in `fixtures/` is a self-contained workspace. Tests are defined in `snapshots.toml`:

```toml
[[e2e]]
name = "descriptive test name"
steps = [
  "vp run build",
  "vp run build", # second run to test caching
]
```

Steps also support an object form with interactions:

```toml
[[e2e]]
name = "interactive step"
steps = [
  { command = "vp interact", interactions = [{ expect-milestone = "ready" }, { write = "hello" }, { write-line = "world" }, { write-key = "up" }, { write-key = "down" }, { write-key = "enter" }] },
  "echo -n | node check-stdin.js",
]
```

Notes:

- String steps are shorthand for `{ command = "..." }`.
- `write-key` accepts `up`, `down`, and `enter`.
- Snapshots include every interaction line, and each `expect-milestone` records the screen at that point.
- For stdin pipe scenarios, write the step command with shell piping, for example: `echo -n | command`.

The test runner:

1. Copies the fixture to a temp directory
2. Executes each step using `/bin/sh` (Unix) or `bash` (Windows)
3. Runs each step in PTY mode (`TestTerminal`)
4. Applies configured interactions in order for PTY steps
5. Captures output and exit codes
6. Compares against snapshot in `fixtures/<name>/snapshots/`

## Adding a new test

1. Create a new fixture directory under `fixtures/`
2. Add `package.json` (and `pnpm-workspace.yaml` for monorepos)
3. Add `snapshots.toml` with test cases
4. Run `cargo test -p vite_task_bin --test e2e_snapshots`
5. Review and accept new snapshots
