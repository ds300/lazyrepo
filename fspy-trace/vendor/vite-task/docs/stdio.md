# Task Standard I/O

How stdin, stdout, and stderr are connected to task processes, controlled by the `--log` flag. Largely inspired by [npm-run-all2](https://github.com/bcomnes/npm-run-all2)'s stdio handling, with differences explained in the [appendix](#appendix-npm-run-all2-behavior).

## The `--log` Flag

```
vp run build --log=<mode>
```

| Mode                        | Description                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `interleaved` **(default)** | Output streams directly to the terminal as tasks produce it.                  |
| `labeled`                   | Each line is prefixed with `[packageName#taskName]`.                          |
| `grouped`                   | Output is buffered per task and printed as a block after each task completes. |

### Examples

In `interleaved` mode, task names are omitted from the command line to keep output clean. In `labeled` and `grouped` modes, the `[pkg#task]` prefix is necessary to identify which task produced each line.

#### `interleaved`

Output goes to the terminal as soon as it's produced. When running multiple tasks in parallel, lines from different tasks may intermix:

```
~/packages/app$ vp dev
~/packages/docs$ vp dev
  VITE v6.0.0  ready in 200 ms

  ➜  Local:   http://localhost:5173/
  VITE v6.0.0  ready in 150 ms

  ➜  Local:   http://localhost:5174/
```

#### `labeled`

Each line of stdout and stderr is prefixed with the task identifier. Output is still streamed as it arrives (not buffered):

```
[app#dev] ~/packages/app$ vp dev
[docs#dev] ~/packages/docs$ vp dev
[app#dev]   VITE v6.0.0  ready in 200 ms
[app#dev]
[app#dev]   ➜  Local:   http://localhost:5173/
[docs#dev]   VITE v6.0.0  ready in 150 ms
[docs#dev]
[docs#dev]   ➜  Local:   http://localhost:5174/
```

#### `grouped`

All output (stdout and stderr) for each task is buffered and printed as a single block when the task completes. Nothing is shown for a task until it finishes:

```
[app#dev] ~/packages/app$ vp dev
[docs#dev] ~/packages/docs$ vp dev
── app#dev ──
  VITE v6.0.0  ready in 200 ms

  ➜  Local:   http://localhost:5173/

── docs#dev ──
  VITE v6.0.0  ready in 150 ms

  ➜  Local:   http://localhost:5174/
```

## stdio by Mode

| Mode                     | stdin       | stdout                       | stderr                       |
| ------------------------ | ----------- | ---------------------------- | ---------------------------- |
| `interleaved`, cache on  | `/dev/null` | Piped (streamed + collected) | Piped (streamed + collected) |
| `interleaved`, cache off | Inherited   | Inherited                    | Inherited                    |
| `labeled`                | `/dev/null` | Piped (prefixed + collected) | Piped (prefixed + collected) |
| `grouped`                | `/dev/null` | Piped (buffered + collected) | Piped (buffered + collected) |

### Key Rules

1. **stdin is `/dev/null` except for uncached tasks in `interleaved` mode.** Cached tasks must have deterministic behavior — inheriting stdin would make output dependent on interactive input, breaking cache correctness. Uncached `interleaved` tasks inherit stdin, allowing interactive prompts.

2. **stdout and stderr are piped (collected) when caching is enabled.** The collected output is stored in the cache and replayed on cache hits. In `interleaved` mode, output is still streamed to the terminal as it arrives — piping is transparent to the user. Uncached `interleaved` tasks inherit stdout/stderr directly.

3. **stderr follows the same rules as stdout in all modes.** Unlike npm-run-all2 where `--aggregate-output` only groups stdout while inheriting stderr, `grouped` mode buffers both stdout and stderr, keeping a task's error output together with its regular output.

## Cache Replay

When a cached task is replayed, its stored stdout and stderr are written to the terminal using the same formatting rules as the current `--log` mode. For example, a task cached in `interleaved` mode can be replayed in `labeled` mode and will receive the appropriate prefix.

## Appendix: npm-run-all2 Behavior

For reference, npm-run-all2 controls stdio via two independent flags:

| Mode                 | stdin     | stdout                                     | stderr                               |
| -------------------- | --------- | ------------------------------------------ | ------------------------------------ |
| Default              | Inherited | Inherited                                  | Inherited                            |
| `--print-label`      | Inherited | Each line prefixed with `[taskName]`       | Each line prefixed with `[taskName]` |
| `--aggregate-output` | Inherited | Grouped per task, printed after completion | Inherited (not grouped)              |

Notable differences from vite-task:

- **stdin is always inherited.** npm-run-all2 does not have a caching system, so there is no need to prevent interactive input.
- **`--aggregate-output` only groups stdout.** stderr is inherited and streams directly to the terminal, meaning error output from parallel tasks can still intermix. vite-task's `grouped` mode buffers both streams.
- **Two separate flags** (`--print-label`, `--aggregate-output`) instead of a single `--log` enum. The flags are mutually exclusive in practice but this isn't enforced.
