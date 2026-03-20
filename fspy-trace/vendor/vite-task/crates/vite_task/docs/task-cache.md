# Task Cache

Vite Task implements a caching system to avoid re-running tasks when their inputs haven't changed. This document describes the architecture, design decisions, and implementation details of the task cache system.

## Overview

The task cache system enables:

- **Incremental builds**: Only run tasks when inputs have changed
- **Shared caching**: Multiple tasks with identical commands can share cache entries
- **Content-based hashing**: Cache keys based on actual content, not timestamps
- **Output replay**: Cached stdout/stderr are replayed exactly as originally produced
- **Two-tier caching**: Cache entries shared across tasks, with task-run associations
- **Configurable input**: Control which files are tracked for cache invalidation

### Shared caching

For tasks defined as below:

```jsonc
// package.json
{
  "scripts": {
    "build": "echo $foo",
    "test": "echo $foo && echo $bar",
  },
}
```

the task cache system is able to hit the same cache for the `test` task and for the first subcommand in the `build` task:

1. user runs `vp run build` -> no cache hit. run `echo $foo` and create cache
2. user runs `vp run test`
   1. `echo $foo` -> **hit cache created in step 1 and replay**
   2. `echo $bar` -> no cache hit. run `echo $bar` and create cache
3. user changes env `$foo`
4. user runs `vp run test`
   1. `echo $foo`
      1. the cache system should be able to **locate the cache that was created in step 1 and hit in step 2.1**
      2. compare the spawn fingerprint and report cache miss because `$foo` is changed.
      3. re-run and replace the cache with a new one.
   2. `echo $bar` -> hit cache created in step 2.2 and replay
5. user runs `vp run build`: **hit the cache created in step 4.1.3 and replay**.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                     Task Execution Flow                                              │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  1. Task Request                                                                     │
│  ────────────────                                                                    │
│    app#build                                                                         │
│         │                                                                            │
│         ▼                                                                            │
│  2. Cache Key Generation                                                             │
│  ──────────────────────                                                              │
│    • Spawn fingerprint (cwd, program, args, env)                                    │
│    • Input configuration                                                             │
│         │                                                                            │
│         ▼                                                                            │
│  3. Cache Lookup (SQLite)                                                            │
│  ────────────────────────                                                            │
│    ┌─────────────────┬──────────────────────┐──────────────────────────┐             │
│    │   Cache Hit     │   Cache Not Found    │  Cache Found but Miss    │             │
│    └────────┬────────┴─────────┬────────────┘──────────────────┬───────┘             │
│             │                  │                               │                     │
│             ▼                  ▼                               ▼                     │
│  4a. Validate Fingerprint   4b. Execute Task   ◀───── 4c. Report what changed       │
│  ────────────────────────   ────────────────                                        │
│    • Inputs unchanged?         • Run command                                         │
│    • Spawn config same?        • Monitor files (fspy)                                │
│                                • Capture stdout/stderr                               │
│             │                         │                                              │
│             ▼                         ▼                                              │
│  5a. Replay Outputs        5b. Store in Cache                                        │
│  ──────────────────        ──────────────────                                        │
│    • Write to stdout           • Save fingerprint                                    │
│    • Write to stderr           • Save outputs                                        │
│                                • Update database                                     │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Cache Key Components

### 1. Cache Entry Key

The cache entry key uniquely identifies a command execution context:

```rust
pub struct CacheEntryKey {
    pub spawn_fingerprint: SpawnFingerprint,
    pub input_config: ResolvedInputConfig,
}
```

### 2. Spawn Fingerprint

The spawn fingerprint captures the complete execution context:

```rust
pub struct SpawnFingerprint {
    pub cwd: RelativePathBuf,
    pub program_fingerprint: ProgramFingerprint,
    pub args: Arc<[Str]>,
    pub env_fingerprints: EnvFingerprints,
}

pub struct EnvFingerprints {
    pub fingerprinted_envs: BTreeMap<Str, Arc<str>>,
    pub untracked_env_config: Arc<[Str]>,
}

enum ProgramFingerprint {
    OutsideWorkspace { program_name: Str },
    InsideWorkspace { relative_program_path: RelativePathBuf },
}
```

This ensures cache invalidation when:

- Working directory changes (package location changes)
- Command or arguments change
- Declared environment variables differ (untracked envs don't affect cache)
- Program location changes (inside/outside workspace)

### 3. Environment Variable Impact on Cache

The `fingerprinted_envs` field in `EnvFingerprints` is crucial for cache correctness:

- Only includes env vars explicitly declared in the task's `env` array
- Does NOT include untracked envs (PATH, CI, etc.)
- These env vars become part of the cache key

When a task runs:

1. All env vars (including untracked) are available to the process
2. Only declared env vars affect the cache key
3. If a declared env var changes value, cache will miss
4. If an untracked env changes, cache will still hit

The `untracked_env_config` field stores env names (not values) — if the set of untracked env names changes, the cache invalidates, but value changes don't.

### 4. Execution Cache Key

The execution cache key associates a task identity with its cache entry:

```rust
pub enum ExecutionCacheKey {
    UserTask {
        task_name: Str,
        and_item_index: usize,
        extra_args: Arc<[Str]>,
        package_path: RelativePathBuf,
    },
    ExecAPI(Arc<[Str]>),
}
```

### 5. Cache Entry Value

The cached execution result:

```rust
pub struct CacheEntryValue {
    pub post_run_fingerprint: PostRunFingerprint,
    pub std_outputs: Arc<[StdOutput]>,
    pub duration: Duration,
    pub globbed_inputs: BTreeMap<RelativePathBuf, u64>,
}
```

### 6. Input File Tracking

Vite Task uses `fspy` to monitor file system access during task execution:

```
┌──────────────────────────────────────────────────────────────┐
│                  File System Monitoring                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Task Execution:                                             │
│  ──────────────                                              │
│    1. Start fspy monitoring                                  │
│    2. Execute task command                                   │
│    3. Capture accessed files                                 │
│    4. Stop monitoring                                        │
│         │                                                    │
│         ▼                                                    │
│  Fingerprint Generation:                                     │
│  ──────────────────────                                      │
│    For each accessed file:                                   │
│    • Check if file exists                                    │
│    • If file: Hash contents with xxHash3                     │
│    • If directory: Record structure                          │
│    • If missing: Mark as NotFound                            │
│         │                                                    │
│         ▼                                                    │
│  Path Fingerprint Types:                                     │
│  ──────────────────────                                      │
│    enum PathFingerprint {                                    │
│        NotFound,                   // File doesn't exist     │
│        FileContentHash(u64),       // xxHash3 of content     │
│        Folder(Option<BTreeMap<Str, DirEntryKind>>),          │
│    }             ▲                                           │
│                  │                                           │
│  This value is `None` when fspy reports that the task is     │
│  opening a folder but not reading its entries. This can      │
│  happen when the opened folder is used as a dirfd for        │
│  `openat(2)`. In such case, the folder's entries don't need  │
│  to be fingerprinted.                                        │
│  Folders with empty entries fingerprinted are represented as │
│  `Folder(Some(empty BTreeMap))`.                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 7. Inputs Configuration

The `input` field in `vite-task.json` controls which files are tracked for cache fingerprinting:

```json
{
  "tasks": {
    "build": {
      "input": ["src/**", "!dist/**", { "auto": true }]
    }
  }
}
```

- **Omitted** (default): `[{auto: true}]` — automatically tracks which files the task reads via `fspy`
- **`[]`** (empty array): disables file tracking entirely
- **Glob patterns** (e.g. `"src/**"`): select specific files
- **`{auto: true}`**: enables automatic file tracking
- **Negative patterns** (e.g. `"!dist/**"`): exclude matched files

See [inputs.md](../../../docs/inputs.md) for full details.

### 8. Fingerprint Validation

When a cache entry exists, the fingerprint is validated to detect changes:

```rust
pub enum FingerprintMismatch {
    SpawnFingerprint { old: SpawnFingerprint, new: SpawnFingerprint },
    InputConfig,
    InputChanged { kind: InputChangeKind, path: RelativePathBuf },
}

pub enum InputChangeKind {
    ContentModified,
    Added,
    Removed,
}
```

## Cache Storage

### Storage Backend

Vite Task uses SQLite with WAL (Write-Ahead Logging) mode for cache storage:

```rust
// Database initialization
let conn = Connection::open(cache_path)?;
conn.pragma_update(None, "journal_mode", "WAL")?;  // Better concurrency
conn.pragma_update(None, "synchronous", "NORMAL")?; // Balance speed/safety
```

### Database Schema

```sql
-- Cache entries keyed by spawn fingerprint + input config
CREATE TABLE cache_entries (
    key BLOB PRIMARY KEY,    -- Serialized CacheEntryKey
    value BLOB               -- Serialized CacheEntryValue
);

-- Maps task identity to its cache entry key
CREATE TABLE task_fingerprints (
    key BLOB PRIMARY KEY,    -- Serialized ExecutionCacheKey
    value BLOB               -- Serialized CacheEntryKey
);
```

### Serialization

Cache entries are serialized using `bincode` for efficient storage.

## Cache Operations

### Cache Hit Flow

```
┌──────────────────────────────────────────────────────────────┐
│                      Cache Hit Process                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Generate Cache Keys                                      │
│  ──────────────────────                                      │
│    CacheEntryKey {                                           │
│        spawn_fingerprint: SpawnFingerprint { ... },          │
│        input_config: ResolvedInputConfig { ... },            │
│    }                                                         │
│    ExecutionCacheKey::UserTask {                              │
│        task_name: "build",                                   │
│        package_path: "packages/app",                         │
│        ...                                                   │
│    }                                                         │
│         │                                                    │
│         ▼                                                    │
│  2. Query Cache                                              │
│  ──────────────                                              │
│    SELECT value FROM cache_entries WHERE key = ?             │
│         │                                                    │
│         ▼                                                    │
│  3. Validate Post-Run Fingerprint                           │
│  ─────────────────────────────────                           │
│    • Check input file hashes                                │
│    • Detect file content changes, additions, removals       │
│         │                                                    │
│         ▼                                                    │
│  4. Replay Outputs                                          │
│  ─────────────────                                           │
│    • Write to stdout/stderr                                  │
│    • Preserve original order                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Cache Miss and Storage

```
┌──────────────────────────────────────────────────────────────┐
│                    Cache Miss Process                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Execute Task with Monitoring                             │
│  ───────────────────────────────                             │
│    • Start fspy file monitoring                              │
│    • Capture stdout/stderr                                   │
│    • Execute command                                         │
│    • Stop monitoring                                         │
│         │                                                    │
│         ▼                                                    │
│  2. Generate Post-Run Fingerprint                           │
│  ─────────────────────────────────                           │
│    • Hash all accessed files                                 │
│    • Record file system access patterns                     │
│         │                                                    │
│         ▼                                                    │
│  3. Create CacheEntryValue                                   │
│  ────────────────────────────                                │
│    CacheEntryValue {                                         │
│        post_run_fingerprint,                                 │
│        std_outputs,                                          │
│        duration,                                             │
│        globbed_inputs,                                       │
│    }                                                         │
│         │                                                    │
│         ▼                                                    │
│  4. Store in Database                                        │
│  ────────────────────                                        │
│    INSERT/UPDATE cache_entries + task_fingerprints            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Cache Invalidation

### Automatic Invalidation

Cache entries are automatically invalidated when:

1. **Command changes**: Different command, arguments, or working directory
2. **Package location changes**: Working directory (`cwd`) in spawn fingerprint changes
3. **Environment changes**: Modified declared environment variables (untracked env values don't affect cache)
4. **Untracked env config changes**: Untracked environment names added/removed from configuration
5. **Input files change**: Content hash differs (detected via xxHash3)
6. **File structure changes**: Files added, removed, or type changed
7. **Input config changes**: The `input` configuration itself changes

## Configuration

### Cache Location

The cache database is stored at `node_modules/.vite/task-cache` in the workspace root.

### Global Cache Control

The root `vite-task.json` can configure caching for the entire workspace:

```json
{
  "cache": true,
  "tasks": { ... }
}
```

- `true` — enables caching for both scripts and tasks
- `false` — disables all caching
- `{ "scripts": false, "tasks": true }` — default; tasks are cached but package.json scripts are not
- `{ "scripts": true, "tasks": true }` — cache everything

### Task-Level Cache Control

Individual tasks can enable or disable caching:

```json
{
  "tasks": {
    "build": {
      "command": "tsc && rollup -c",
      "cache": true,
      "dependsOn": ["lint"]
    },
    "deploy": {
      "command": "deploy-script.sh",
      "cache": false
    }
  }
}
```

### CLI Cache Override

The `--cache` and `--no-cache` flags override all cache configuration for a single run:

```bash
vp run build --no-cache    # force cache off
vp run build --cache       # force cache on (even for scripts)
```

## Output Capture and Replay

### Output Capture During Execution

Outputs are captured exactly as produced:

- Preserves order of stdout/stderr interleaving
- Handles binary output (e.g., from tools that output progress bars)
- Maintains ANSI color codes and formatting

### Output Replay on Cache Hit

When a task hits cache, outputs are replayed exactly:

```
┌──────────────────────────────────────────────────────────────┐
│                    Output Replay                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Cached Outputs:                                             │
│  ──────────────                                              │
│    [                                                         │
│      StdOutput { kind: StdOut, "Compiling..." },             │
│      StdOutput { kind: StdErr, "Warning: ..." },             │
│      StdOutput { kind: StdOut, "✓ Build complete" }          │
│    ]                                                         │
│         │                                                    │
│         ▼                                                    │
│  Replay Process:                                             │
│  ──────────────                                              │
│    1. Write "Compiling..." to stdout                         │
│    2. Write "Warning: ..." to stderr                         │
│    3. Write "✓ Build complete" to stdout                     │
│         │                                                    │
│         ▼                                                    │
│  Result: Identical output as original execution              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Performance Optimizations

### Fast Hashing with xxHash3

Vite Task uses xxHash3 for file content hashing, providing excellent performance (~10GB/s on modern CPUs).

### File System Monitoring

Instead of scanning all possible input files, `fspy` monitors actual file access:

```
Traditional Approach:
  Scan all src/**/*.ts files → Hash everything
  Problem: Hashes files never accessed

Vite Task Approach:
  Monitor with fspy → Hash only accessed files
  Benefit: Minimal work, accurate dependencies
```

### SQLite Optimizations

- WAL mode for better concurrency
- Balanced durability for performance
- Prepared/cached statements for efficiency

### Binary Serialization

Using `bincode` for compact, fast serialization with direct storage without text conversion.

## Best Practices

### 1. Deterministic Commands

Ensure commands produce identical outputs for identical inputs:

```json
// ✅ Good: Deterministic output
{
  "tasks": {
    "build": {
      "command": "tsc && echo Build complete"
    }
  }
}
```

### 2. Disable Cache for Side Effects

```json
{
  "tasks": {
    "deploy": {
      "command": "deploy-to-production.sh",
      "cache": false
    }
  }
}
```

### 3. Use `input` for Precise Cache Control

```json
{
  "tasks": {
    "build": {
      "input": ["src/**", "tsconfig.json", "!src/**/*.test.ts"]
    }
  }
}
```

### 4. Compound Commands for Granular Caching

```json
{
  "scripts": {
    "build": "tsc && rollup -c && terser dist/bundle.js"
  }
}
```

Each `&&` separated command is cached independently. If only terser config changes, TypeScript and rollup will hit cache.

## Implementation Reference

### Core Cache Components

```
crates/vite_task/src/session/
├── cache/
│   ├── mod.rs            # ExecutionCache, CacheEntryKey/Value, FingerprintMismatch
│   └── display.rs        # Cache status display formatting
├── execute/
│   ├── mod.rs            # execute_spawn, SpawnOutcome
│   ├── fingerprint.rs    # PostRunFingerprint, PathFingerprint, DirEntryKind
│   └── spawn.rs          # spawn_with_tracking, fspy integration
└── reporter/
    └── mod.rs            # Reporter traits for cache hit/miss display

crates/vite_task_plan/src/
├── cache_metadata.rs     # ExecutionCacheKey, SpawnFingerprint, ProgramFingerprint, CacheMetadata
├── envs.rs               # EnvFingerprints
└── plan.rs               # Planning logic
```
