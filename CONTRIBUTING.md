# Contributing to `lazyrepo`

## Issues and Questions

Feel free to submit Issues for

- Bug reports
- Specific, detailed feature requests
- Something doesn't work how you expect

Also feel free to offer to work on any issues!

Please make suggestions or ask other kinds of questions in Discussions.

## The codebase

We use

- `pnpm` for package management.
- `prettier` for formatting.
- `eslint` for linting
- `jest` for tests

### Structure

Please keep all code related to testing in the `test` directory and all code used by the `lazy` cli in the `src` directory. The `test` directory is not included in the package when it is published.

At the time of writing, there are dev scripts in the repo, but if you need to add one please create a `scripts` directory. These should be typescript files or bash scripts unless there's good reason to do something else.

### JS + TS

`lazyrepo` is written in JavaScript with TypeScript types as JSDoc comments. This allows us to avoid having a build step.

Any test code is written in `.ts` files.

At the time of writing we have one `types.d.ts` file to make it easier to define types used in the `.js` files. Feel free to split that file up or add new `.d.ts` files if it makes sense.

## Submitting Pull Requests

Feel free to submit pull requests! Ask before working on big stuff otherwise you might be disappointed if it gets rejected for some reason.

If there's an issue for the thing you're working on, please let folks know that you're working on it in the issue. Do a quick search in discussions too.

## Testing Locally

If you want to test lazyrepo locally, you can run `pnpm pack-test-version` and then use the resulting tarball to add `lazyrepo` to a local test project.

This test tarball will read the source files from your local git checkout, so you can make changes and test them without having to publish a new version or do any tricky linking.
