# LAZYREPO

`lazyrepo` is a caching task runner for npm/pnpm/yarn monorepos. It aims to fit right into the slot
that `turborepo` carved out: making your `package.json` `"scripts"` scale better without having to
opt in to an industrial-strength build system like `nx`, `bazel`, `rush`, or `buck`.

## Installation

Install lazyrepo globally

- `pnpm install lazyrepo --global`
- `yarn add lazyrepo --global`
- `npm install lazyrepo --global`

And also as a dev dependency for your project

- `pnpm install lazyrepo --save-dev`
- `yarn add lazyrepo --dev`
- `npm install lazyrepo --save-dev`

Then `lazy init` to create a config file.

And finally add `.lazy` to your .gitignore

    echo "\n\n#lazyrepo\n.lazy" >> .gitignore

## Usage

Run tasks defined in workspace packages using `lazy run <task>`

The default caching/ordering behavior is optimized for 'test'-style scripts. Let's say you have two
packages `app` and `utils`. `app` depends on `utils` and they both have `"test"` scripts.

The empty `lazy.config.ts` file looks like this:

```ts
import type { LazyConfig } from 'lazyrepo'
export default {} satisfies LazyConfig
```

- `utils`'s tests will be executed before `app`'s. If `utils`'s tests fail `app`'s tests will not
  run. This is because if something breaks in `utils` it could lead to false negatives in `app`'s
  test suite.
- If I change a source file in `app`, only `app`'s tests needs to run again.
- If I change a source file in `utils`, both `utils` and `app` need to be retested.

If we want to have explicit config for this it would look like

```ts
import type { LazyConfig } from 'lazyrepo'
export default {
  tasks: {
    test: {
      cache: {
        inputs: ['**/*'],
        outputs: [],
        usesOutputFromDependencies: true,
      },
    },
  },
} satisfies LazyConfig
```

## Migrating from turborepo

TODO

## Why not use/improve turborepo?

At the time of writing:

- It's slow. It used to be fast so I assume this is a temporary situation?
- It lacks tools for debugging misbehaving pipelines.
- It has a cryptic configuration format that lacks discoverability and clarity.
- Some of the default behaviors are questionable and have been problematic.
- It's written in a mix of go and rust and is currently being developed in tandem with `turbopack`,
  apparently for the purposes of sharing code. This makes the barrier of entry to contribution too
  high for a lot of folks.
