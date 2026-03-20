# Task Inputs Configuration

The `inputs` field controls which files are tracked for cache invalidation. When any tracked input file changes, the task's cache is invalidated and the task will re-run.

## Default Behavior

When `inputs` is omitted, vite-task automatically tracks files that the command reads during execution using fspy (file system spy):

```json
{
  "tasks": {
    "build": {
      "command": "tsc"
    }
  }
}
```

Files read by `tsc` are automatically tracked. **In most cases, you don't need to configure `inputs` at all.**

## Input Types

### Glob Patterns

Specify files using glob patterns relative to the package directory:

```json
{
  "inputs": ["src/**/*.ts", "package.json"]
}
```

Supported glob syntax:

- `*` - matches any characters except `/`
- `**` - matches any characters including `/`
- `?` - matches a single character
- `[abc]` - matches any character in the brackets
- `[!abc]` - matches any character not in the brackets

### Auto-Inference

Enable automatic input detection using fspy (file system spy):

```json
{
  "inputs": [{ "auto": true }]
}
```

When enabled, vite-task automatically tracks files that the command actually reads during execution. This is the default behavior when `inputs` is omitted.

### Negative Patterns

Exclude files from tracking using `!` prefix:

```json
{
  "inputs": ["src/**", "!src/**/*.test.ts"]
}
```

Negative patterns filter out files that would otherwise be matched by positive patterns or auto-inference.

## Configuration Examples

### Explicit Globs Only

Specify exact files to track, disabling auto-inference:

```json
{
  "tasks": {
    "build": {
      "command": "tsc",
      "inputs": ["src/**/*.ts", "tsconfig.json"]
    }
  }
}
```

Only files matching the globs are tracked. Files read by the command but not matching the globs are ignored.

### Auto-Inference with Exclusions

Track inferred files but exclude certain patterns:

```json
{
  "tasks": {
    "build": {
      "command": "tsc",
      "inputs": [{ "auto": true }, "!dist/**", "!node_modules/**"]
    }
  }
}
```

Files in `dist/` and `node_modules/` won't trigger cache invalidation even if the command reads them.

### Mixed Mode

Combine explicit globs with auto-inference:

```json
{
  "tasks": {
    "build": {
      "command": "tsc",
      "inputs": ["package.json", { "auto": true }, "!**/*.test.ts"]
    }
  }
}
```

- `package.json` is always tracked (explicit)
- Files read by the command are tracked (auto)
- Test files are excluded from both (negative pattern)

### No File Inputs

Disable all file tracking (cache only on command/env changes):

```json
{
  "tasks": {
    "echo": {
      "command": "echo hello",
      "inputs": []
    }
  }
}
```

The cache will only invalidate when the command itself or environment variables change.

## Behavior Summary

| Configuration                            | Auto-Inference | File Tracking                 |
| ---------------------------------------- | -------------- | ----------------------------- |
| `inputs` omitted                         | Enabled        | Inferred files                |
| `inputs: [{ "auto": true }]`             | Enabled        | Inferred files                |
| `inputs: ["src/**"]`                     | Disabled       | Matched files only            |
| `inputs: [{ "auto": true }, "!dist/**"]` | Enabled        | Inferred files except `dist/` |
| `inputs: ["pkg.json", { "auto": true }]` | Enabled        | `pkg.json` + inferred files   |
| `inputs: []`                             | Disabled       | No files tracked              |

## Important Notes

### Glob Base Directory

Glob patterns are resolved relative to the **package directory** (where `package.json` is located), not the task's working directory (`cwd`).

```json
{
  "tasks": {
    "build": {
      "command": "tsc",
      "cwd": "src",
      "inputs": ["src/**/*.ts"] // Still relative to package root
    }
  }
}
```

### Negative Patterns Apply to Both Modes

When using mixed mode, negative patterns filter both explicit globs AND auto-inferred files:

```json
{
  "inputs": ["src/**", { "auto": true }, "!**/*.generated.ts"]
}
```

Files matching `*.generated.ts` are excluded whether they come from the `src/**` glob or from auto-inference.

### Auto-Inference Behavior

The auto-inference (fspy) is intentionally **cautious** - it tracks all files that a command reads, even auxiliary files. This means **negative patterns are expected to be useful** for filtering out files you don't want to trigger cache invalidation.

Common files you might want to exclude:

```json
{
  "inputs": [
    { "auto": true },
    "!**/*.tsbuildinfo", // TypeScript incremental build info
    "!**/tsconfig.tsbuildinfo",
    "!dist/**" // Build outputs that get read during builds
  ]
}
```

**When to use positive patterns vs negative patterns:**

- **Negative patterns (expected)**: Use these to exclude files that fspy correctly detected but you don't want tracked (like `.tsbuildinfo`, cache files, build outputs)
- **Positive patterns (usually indicates a bug)**: If you find yourself adding explicit positive patterns because fspy missed files that your command actually reads, this likely indicates a bug in fspy

If you encounter a case where fspy fails to detect a file read, please [report the issue](https://github.com/voidzero-dev/vite-task/issues) with:

1. The command being run
2. The file(s) that weren't detected
3. Steps to reproduce

### Cache Disabled

The `inputs` field cannot be used with `cache: false`:

```json
// ERROR: inputs cannot be specified when cache is disabled
{
  "tasks": {
    "dev": {
      "command": "vite dev",
      "cache": false,
      "inputs": ["src/**"] // This will cause a parse error
    }
  }
}
```
