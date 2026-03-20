# Vite Task

Monorepo task runner with intelligent caching and dependency-aware scheduling, powering [`vp run`](https://github.com/voidzero-dev/vite-plus) in [Vite+](https://viteplus.dev).

## Getting Started

Install [Vite+](https://viteplus.dev), then run tasks from your workspace. See the [documentation](https://viteplus.dev/guide/run) for full usage.

```bash
vp run build              # run a task in the current package
vp run build -r           # run across all packages in dependency order
vp run @my/app#build -t   # run in a package and its transitive dependencies
vp run --cache build      # run with caching enabled
```

## License

[MIT](LICENSE)

Copyright (c) 2026-present [VoidZero Inc.](https://voidzero.dev/)
