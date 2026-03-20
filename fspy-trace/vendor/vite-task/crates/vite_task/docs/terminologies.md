# Terminologies

### Task-Related Names

```jsonc
// package.json
{
  "name": "app",
  "scripts": {
    "build": "echo build1 && echo build2",
  },
}
```

```jsonc
// vite-task.json
{
  "tasks": {
    "lint": {
    "command": "echo lint"
  }
}
```

In the example above, `build` and `lint` are **task group names**. A task group may define one task, or multiple tasks separated by `&&`.

The two task groups generates 3 tasks:

- `app#build(subcommand 0)` (runs `echo build1`)
- `app#build` (runs `echo build2`)
- `app#lint` (runs `echo lint`)

These are **task names**. They are for displaying and filtering.

The user could execute `vp run build` under the `app` package, or execute `vp run app#build` from anywhere. The parameter `build` and `app#build` after `vp run` are **task requests**. They are used to match against task names to determine what tasks to run.
