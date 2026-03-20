# vite_task_plan

Execution planning layer for the vite-task monorepo task runner. This crate converts abstract task definitions from the task graph into concrete execution plans ready for execution.

## Overview

`vite_task_plan` sits between [`vite_task_graph`](../vite_task_graph) (which defines what tasks exist and their dependencies) and the actual task executor. It resolves all the runtime details needed to execute tasks:

- Environment variables (fingerprinted and pass-through)
- Working directories
- Command parsing and expansion
- Process spawn configuration
- Caching metadata

## Key Concepts

### Execution Plan

The main output of this crate is an [`ExecutionPlan`](src/lib.rs), which contains a **tree** of task executions with all runtime details resolved.

```rust
let plan = ExecutionPlan::plan(plan_request, cwd, envs, callbacks).await?;
plan.root_node() // Root execution node
```

### Plan Requests

There are two types of execution requests:

1. **Query Request** - Execute tasks from the task graph (e.g., `vp run -r build`)
   - Queries the task graph based on task patterns
   - Builds execution graph with dependency ordering

2. **Synthetic Request** - Execute on-the-fly tasks not in the graph (e.g., `vp lint` in a task script)
   - Generated dynamically by the TaskSynthesizer
   - Used for synthesized commands within task scripts

### Execution Items

Each task's command is parsed and split into execution items:

- **Spawn Execution** - Spawns a child process
  - Contains: resolved env vars, cwd, program/args or shell script
  - Environment resolution for cache fingerprinting

- **In-Process Execution** - Runs built-in commands in-process
  - Optimizes simple commands like `echo`
  - No process spawn overhead

- **Expanded Execution** - Nested execution graph
  - Commands like `vp run ...` expand into sub-graphs
  - Enables composition of vp commands

### Command Parsing

Commands are intelligently parsed:

```bash
# Single command -> Single spawn execution
"tsc --noEmit"

# Multiple commands -> Multiple execution items
"tsc --noEmit && vp run test && echo Done"
#     ↓              ↓                ↓
# SpawnExecution  Expanded      InProcess
```

### Error Handling

- **Recursion Detection** - Prevents infinite task dependency loops
- **Call Stack Tracking** - Maintains task call stack for error reporting
