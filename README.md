<div alt style="text-align: center; transform: scale(.5);">
  <img alt="LAZYREPO" src="https://github.com/ds300/lazyrepo/raw/main/assets/lazyrepo.png" />
</div>

> 💡 Currently in early alpha!

`lazyrepo` is a zero-config caching task runner for npm/pnpm/yarn monorepos.

It fits right into the slot that `turborepo` carved out: making your `"scripts"` commands scale better without having to opt in to an industrial-strength build system like `nx`, `bazel`, `rush`, or `buck`.

`lazyrepo` is scary fast, a lot faster than `turborepo`. And this is despite being written in TypeScript instead of some young handsome witty systems language.

`lazyrepo` has a human-friendly config format, and the defaults are profoundly sensible. Best of all, it gives you helpful concise feedback so you can quickly debug when things aren't working quite how you'd expect.

Trust me, the whole situation is so delightful it will make you wish there was a `:chefs-kiss:` emoji.

## Installation

Install lazyrepo globally

- `pnpm install lazyrepo --global`
- `yarn add lazyrepo --global`
- `npm install lazyrepo --global`

And also as a dev dependency for your project

- `pnpm install lazyrepo --workspace-root --save-dev`
- `yarn add lazyrepo --dev`
- `npm install lazyrepo --save-dev`

And finally add `.lazy` to your .gitignore

    echo "\n\n#lazyrepo\n.lazy" >> .gitignore

## Usage + Configuration

Run tasks defined in workspace packages using `lazy run <task>`, or just `lazy <task>` if you're into the whole brevity thing.

### Task ordering + caching

The default behavior is optimized for `"test"`-style scripts, where:

- The order of execution matters if there are dependencies between packages.
- Changes to files should trigger runs for any dependent (downstream) packages.
- There are no output artifacts.

Let's say you have two packages `app` and `utils`. `app` depends on `utils` and they both have `"test"` scripts.

With an empty config file, when you run `lazy test`

- `utils`'s tests will be executed before `app`'s. If `utils`'s tests fail `app`'s tests will not run. This is because if something breaks in `utils` it could lead to false negatives in `app`'s test suite.
- If I change a source file in `app`, only `app`'s tests needs to run again.
- If I change a source file in `utils`, both `utils` and `app` need to be retested.

To explicitly configure this default behavior for the `"test"` scripts, your config file would look like this:

```ts
export default {
  tasks: {
    test: {
      cache: {
        // by default we consider all files in the package directory
        inputs: ['**/*'],
        // there are no outputs
        outputs: [],
        // a test invocation depends on the input files of any upstream packages
        inheritsInputFromDependencies: true,
      },
    },
  },
}
```

## Migrating from turborepo

TODO
