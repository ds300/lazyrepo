# LAZYREPO

`lazyrepo` is a caching task runner for npm/pnpm/yarn monorepos. It aims to fit right into the slot that `turborepo` carved out: making your `package.json` `"scripts"` scale better without having to opt in to an industrial-strength build system like `nx`, `bazel`, `rush`, or `buck`.

It's scary fast, despite being implemented with _(yawn)_ TypeScript instead of _(swoon)_ Rust. Although it is actually written in `.js` files with JSDoc-based TypeScript annotations, which makes it profoundly debuggable, [patch](https://github.com/ds300/patch-package)-able, and _pull-request_-able.

It has a human-friendly config format, and the default behaviors are `:chefs-kiss:`-tier.

Best of all, it gives you helpful concise feedback so you can quickly debug when things aren't working quite how you'd expect.

**No more long sad afternoons**. Guaranteed. Or your money back.

## Installation

Install lazyrepo globally

- `pnpm install lazyrepo --global`
- `yarn add lazyrepo --global`
- `npm install lazyrepo --global`

And also as a dev dependency for your project

- `pnpm install lazyrepo --workspace-root --save-dev`
- `yarn add lazyrepo --dev`
- `npm install lazyrepo --save-dev`

Then `lazy init` to create a config file.

And finally add `.lazy` to your .gitignore

    echo "\n\n#lazyrepo\n.lazy" >> .gitignore

## Usage + Configuration

Run tasks defined in workspace packages using `lazy run <task>`

### Task ordering + caching

The default behavior is optimized for 'test'-style scripts, where:

- The order of execution matters if there are dependencies between packages.
- Changes to files should trigger runs for any dependent (downstream) packages.
- There are no output artifacts.

Let's say you have two packages `app` and `utils`. `app` depends on `utils` and they both have `"test"` scripts.

The empty `lazy.config.ts` file looks like this:

```ts
import type { LazyConfig } from 'lazyrepo'
export default {} satisfies LazyConfig
```

- `utils`'s tests will be executed before `app`'s. If `utils`'s tests fail `app`'s tests will not run. This is because if something breaks in `utils` it could lead to false negatives in `app`'s test suite.
- If I change a source file in `app`, only `app`'s tests needs to run again.
- If I change a source file in `utils`, both `utils` and `app` need to be retested.

An explicit version of the default task config would look like

```ts
import type { LazyConfig } from 'lazyrepo'
export default {
  tasks: {
    test: {
      cache: {
        inputs: ['**/*'],
        outputs: [],
        inheritsInputFromDependencies: true,
      },
    },
  },
} satisfies LazyConfig
```

## Debugging

## Migrating from turborepo

TODO
