# Vite Task

A monorepo task runner (like Nx/Turbo) with intelligent caching and dependency resolution, distributed as the `vp run` command in [Vite+](https://github.com/voidzero-dev/vite-plus).

## Repository Structure

- `crates/vite_task` — Task execution engine with caching and session management
- `crates/vite_task_bin` — Internal dev CLI binary (`vt`) and task synthesizer
- `crates/vite_task_graph` — Task dependency graph construction and config loading
- `crates/vite_task_plan` — Execution planning (resolves env vars, working dirs, commands)
- `crates/vite_workspace` — Workspace detection and package dependency graph
- `crates/fspy*` — File system access tracing (9 crates: supervisor, preload libs, platform backends)
- `crates/pty_terminal*` — Cross-platform headless terminal emulator (3 crates)
- `crates/vite_path` — Type-safe absolute/relative path system
- `crates/vite_str` — Stack-allocated compact string type
- `crates/vite_glob` — Glob pattern matching
- `crates/vite_shell` — Shell command parsing
- `crates/vite_select` — Interactive fuzzy selection UI
- `crates/vite_tui` — Terminal UI components (WIP, unfinished)
- `crates/vite_graph_ser` — Graph serialization utilities
- `crates/subprocess_test` — Subprocess testing framework
- `packages/tools` — Node.js test utilities (print, json-edit, check-tty, etc.)
- `docs/` — Documentation (inputs configuration guide)

## Development Commands

```bash
just init          # Install build tools and dependencies
just ready         # Full quality check (fmt, check, test, lint, doc)
just fmt           # Format code (cargo fmt, cargo shear, oxfmt)
just check         # Check compilation with all features
just test          # Run all tests
just lint          # Clippy linting
just lint-linux    # Cross-clippy for Linux (requires cargo-zigbuild)
just lint-windows  # Cross-clippy for Windows (requires cargo-xwin)
just doc           # Documentation generation
```

If `gt` (Graphite CLI) is available in PATH, use it instead of `gh` to create pull requests.

## Tests

```bash
cargo test                                              # All tests
cargo test -p vite_task_bin --test e2e_snapshots        # E2E snapshot tests
cargo test -p vite_task_plan --test plan_snapshots      # Plan snapshot tests
cargo test --test e2e_snapshots -- stdin                # Filter by test name
INSTA_UPDATE=always cargo test                          # Update snapshots
```

Integration tests (e2e, plan, fspy) require `pnpm install` in `packages/tools` first. You don't need `pnpm install` in test fixture directories.

### Test Reliability

The test suite has no known pre-existing failures or flaky tests. If a test fails during your changes, treat it as a real regression caused by your work. Fix the root cause properly — do not skip, ignore, or work around failing tests.

### Test Fixtures

- **Plan**: `crates/vite_task_plan/tests/plan_snapshots/fixtures/` — quicker, sufficient for testing task graph, resolved configs, program paths, cwd, and env vars
- **E2E**: `crates/vite_task_bin/tests/e2e_snapshots/fixtures/` — needed for testing execution, caching, output styling

### Cross-Platform Testing

**CRITICAL**: This project must work on both Unix (macOS/Linux) and Windows. Skipping tests on either platform is **UNACCEPTABLE**.

- Use `#[cfg(unix)]` and `#[cfg(windows)]` for platform-specific code within tests
- Both platforms must execute the test and verify the feature works correctly
- Use cross-platform libraries for common operations (e.g., `terminal_size` for terminal dimensions)

## Architecture

### Task Execution Pipeline

```
CLI (vite_task_bin) → Task Graph (vite_task_graph) → Plan (vite_task_plan) → Execution (vite_task)
                          ↑                                                        ↓
                    vite_workspace                                          fspy (file tracing)
```

### Task Dependencies

1. **Explicit**: Defined via `dependsOn` in `vite-task.json` (skip with `--ignore-depends-on`)
2. **Topological**: Based on package.json dependencies
   - With `-r/--recursive`: runs task across all packages in dependency order
   - With `-t/--transitive`: runs task in current package and its dependencies

### Task Configuration

Tasks are defined in `vite-task.json`:

```json
{
  "cache": true | false | { "scripts": bool, "tasks": bool },
  "tasks": {
    "test": {
      "command": "vitest run",
      "cwd": "relative/path",
      "dependsOn": ["build", "package#task"],
      "cache": true,
      "env": ["NODE_ENV"],
      "untrackedEnv": ["CI"],
      "input": ["src/**", "!dist/**", { "auto": true }]
    }
  }
}
```

## Code Constraints

### Required Patterns

Enforced by `.clippy.toml`:

| Instead of                          | Use                                      |
| ----------------------------------- | ---------------------------------------- |
| `HashMap`/`HashSet`                 | `FxHashMap`/`FxHashSet` from rustc-hash  |
| `std::path::Path`/`PathBuf`         | `vite_path::AbsolutePath`/`RelativePath` |
| `std::format!`                      | `vite_str::format!`                      |
| `String` (for small strings)        | `vite_str::Str`                          |
| `std::env::current_dir`             | `vite_path::current_dir`                 |
| `.to_lowercase()`/`.to_uppercase()` | `cow_utils` methods                      |

### Path Type System

- Use `AbsolutePath` for internal data flow; only convert to `RelativePath` when saving to cache
- Use methods like `strip_prefix`/`join` from `vite_path` instead of converting to std paths
- Only convert to std paths when interfacing with std library functions
- Add necessary methods in `vite_path` instead of falling back to std path types

### Cross-Platform Requirements

All code must work on both Unix and Windows without platform skipping:

- Use `#[cfg(unix)]` / `#[cfg(windows)]` for platform-specific implementations
- Platform differences should be handled gracefully, not skipped
- After major changes to `fspy*` or platform-specific crates, run `just lint-linux` and `just lint-windows`

## Quick Reference

- **Task Format**: `package#task` (e.g., `app#build`, `@test/utils#lint`)
- **Config File**: `vite-task.json` in each package
- **Rust Edition**: 2024, MSRV 1.88.0
