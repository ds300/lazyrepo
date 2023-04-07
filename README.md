# LAZYREPO

`lazyrepo` is a caching task runner for npm/pnpm/yarn monorepos. It aims to fit right into the slot
that `turborepo` carved out: making your `package.json` `"scripts"` scale better without having to
opt in to an industrial-strength build system like `nx`, `bazel`, `rush`, or `buck`.

## Usage

Install with one of

- `pnpm install lazyrepo --save-dev` 
- `yarn add lazyrepo --dev`
- `npm install lazyrepo --save-dev`

Default task behavior is optimized for 'test' scripts. Let's say you have two packages `app` and
`utils`. `app` depends on `utils` and they both have `"test"` scripts.

The `lazy.config.ts` file looks like this:

```ts
import type { LazyConfig } from 'lazyrepo'
export default {} satisfies LazyConfig
```

- `utils`'s tests will be executed before `app`'s. If `utils`'s tests fail `app`'s tests will not
  run. This is because if something breaks in `utils` it could lead to false negatives in `app`'s
  test suite.
- If I change a source file in `app`, only `app`'s tests needs to run again.
- If I change a source file in `utils`, both `utils` and `app` need to be retested.

## Why not use/improve turborepo?

At the time of writing:

- It's slow. It used to be fast so I assume this is a temporary situation?
- It lacks tools for debugging misbehaving pipelines.
- It has a cryptic configuration format that lacks discoverability and clarity.
- Some of the default behaviors are questionable and have been problematic.
- It's written in a mix of go and rust and is currently being developed in tandem with `turbopack`,
  apparently for the purposes of sharing code. This makes the barrier of entry to contribution too
  high for a lot of folks.
