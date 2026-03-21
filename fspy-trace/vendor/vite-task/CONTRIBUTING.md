# Contributing to Vite Task

## Prerequisites

- [Rust](https://rustup.rs/) (see [rust-toolchain.toml](rust-toolchain.toml) for the required version)
- [Node.js](https://nodejs.org/) (^20.19.0 || >=22.12.0)
- [pnpm](https://pnpm.io/) (10.x)
- [just](https://just.systems/) — task runner for build commands
- [cargo-binstall](https://github.com/cargo-bins/cargo-binstall) — for installing Rust tools

## Initial Setup

```bash
just init
```

This installs all required Rust tools (`cargo-insta`, `typos-cli`, `cargo-shear`, `taplo-cli`) and bootstraps the Node.js tooling.

## Development Workflow

Officially, Vite Task is distributed as part of Vite+ and invoked via `vp run`. The `vt` binary (`vite_task_bin` crate) is an internal development CLI for working on this repo in pure Rust without building the full Vite+ stack. Use `cargo run --bin vt` to build and run locally during development. Don't reference `vt` in user-facing documentation — it's not a public interface.

|              | `vp run` (Vite+)                             | `vt run` (this repo) |
| ------------ | -------------------------------------------- | -------------------- |
| Purpose      | End-user CLI                                 | Internal dev/testing |
| Config       | `vite.config.ts` (`run` block)               | `vite-task.json`     |
| Distribution | Bundled in Vite+                             | `cargo run --bin vt` |
| Scope        | Full toolchain (dev, build, test, lint, ...) | Task runner only     |

```bash
just ready    # Full quality check: typos, fmt, check, test, lint, doc
just fmt      # Format code (cargo fmt + cargo shear + oxfmt)
just check    # Check compilation with all features
just test     # Run all tests
just lint     # Clippy linting
just doc      # Generate documentation
```

### Running Specific Tests

```bash
cargo test                                              # All tests
cargo test -p vite_task_bin --test e2e_snapshots        # E2E snapshot tests
cargo test -p vite_task_plan --test plan_snapshots      # Plan snapshot tests
cargo test --test e2e_snapshots -- stdin                # Filter by test name
INSTA_UPDATE=always cargo test                          # Update snapshots
```

Integration tests (e2e, plan, fspy) require `pnpm install` in `packages/tools` first. You don't need `pnpm install` in test fixture directories.

### Test Fixtures

- **Plan snapshots** — `crates/vite_task_plan/tests/plan_snapshots/fixtures/` — quicker, sufficient for testing task graph, resolved configs, program paths, cwd, and env vars
- **E2E snapshots** — `crates/vite_task_bin/tests/e2e_snapshots/fixtures/` — needed for testing actual execution, caching behavior, and output styling

See individual crate READMEs for crate-specific testing details.

## Cross-Platform Development

This project must work on macOS, Linux, and Windows. Skipping tests on any platform is not acceptable.

- Use `#[cfg(unix)]` / `#[cfg(windows)]` for platform-specific code
- Use cross-platform libraries where possible (e.g., `terminal_size` instead of raw ioctl/ConPTY)

### Cross-Platform Linting

After changes to `fspy*` or platform-specific crates, run cross-platform clippy:

```bash
just lint           # Native (host platform)
just lint-linux     # Linux via cargo-zigbuild
just lint-windows   # Windows via cargo-xwin
```

## Code Conventions

### Required Patterns

These are enforced by `.clippy.toml`:

| Instead of                            | Use                                        |
| ------------------------------------- | ------------------------------------------ |
| `HashMap` / `HashSet`                 | `FxHashMap` / `FxHashSet` from rustc-hash  |
| `std::path::Path` / `PathBuf`         | `vite_path::AbsolutePath` / `RelativePath` |
| `std::format!`                        | `vite_str::format!`                        |
| `String` (for small strings)          | `vite_str::Str`                            |
| `std::env::current_dir`               | `vite_path::current_dir`                   |
| `.to_lowercase()` / `.to_uppercase()` | `cow_utils` methods                        |

### Path Type System

All paths use `vite_path` for type safety:

- **`AbsolutePath` / `AbsolutePathBuf`** — for internal data flow
- **`RelativePath` / `RelativePathBuf`** — for cache storage and display

Use `vite_path` methods (`strip_prefix`, `join`, etc.) instead of converting to `std::path`. Only convert to std paths when interfacing with std library functions. Add necessary methods to `vite_path` rather than falling back.

## macOS Performance Tip

Add your terminal app to the approved "Developer Tools" in System Settings > Privacy & Security. Your Rust builds will be ~30% faster.
