# Plan Snapshot Tests

Tests for task graph construction and execution plan generation.

## When to add tests here

- Testing task graph structure (dependencies, task resolution)
- Testing execution plan generation from CLI arguments
- Testing task fingerprinting and cache key computation
- Testing workspace/package discovery and configuration parsing

## How it works

Each fixture in `fixtures/` is a self-contained workspace. Tests are defined in `snapshots.toml`:

```toml
[[plan]]
name = "descriptive test name"
args = ["build", "--recursive"]
cwd = "packages/app" # optional, defaults to workspace root
```

The test runner:

1. Copies the fixture to a temp directory
2. Loads the workspace and builds the task graph
3. Snapshots the task graph structure
4. For each plan test, parses CLI args and generates an execution plan
5. Compares against snapshots in `fixtures/<name>/snapshots/`

## Adding a new test

1. Create a new fixture directory under `fixtures/`
2. Add `package.json` (and `pnpm-workspace.yaml` for monorepos)
3. Add `snapshots.toml` with test cases (or omit for task-graph-only tests)
4. Run `cargo test -p vite_task_plan --test plan_snapshots`
5. Review and accept new snapshots
