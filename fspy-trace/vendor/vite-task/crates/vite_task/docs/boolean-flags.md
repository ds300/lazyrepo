# Boolean Flags in Vite Task

This document describes how boolean flags work in `vp` commands.

## Available Boolean Flags

### Run Command Flags

- `--recursive` / `-r` — Run task in all packages in the workspace
- `--transitive` / `-t` — Run task in the current package and its transitive dependencies
- `--workspace-root` / `-w` — Run task in the workspace root package
- `--ignore-depends-on` — Skip explicit `dependsOn` dependencies
- `--verbose` / `-v` — Show full detailed summary after execution
- `--cache` / `--no-cache` — Force caching on or off for all tasks and scripts

### Negation Pattern

The `--cache` flag supports a `--no-cache` negation form. When `--no-cache` is used, caching is explicitly disabled for all tasks in that run:

```bash
# Force caching off
vp run build --no-cache

# Force caching on (even for scripts that default to uncached)
vp run build --cache
```

The positive and negative forms are mutually exclusive — you cannot use both `--cache` and `--no-cache` in the same command.

## Examples

```bash
# Recursive build (all packages in dependency order)
vp run build -r

# Current package + transitive dependencies
vp run build -t

# Run in workspace root
vp run build -w

# Skip explicit dependsOn edges
vp run build --ignore-depends-on

# Verbose output
vp run build -v

# Force caching off for this run
vp run build --no-cache
```

## Implementation Details

The flags use clap's argument parsing. The `--cache`/`--no-cache` pair uses clap's `conflicts_with` attribute to ensure they cannot be used together.
