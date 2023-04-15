import { Dir, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const simpleDir: Dir = {
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/core',
        scripts: {
          build: 'echo $RANDOM > .out.txt',
        },
        dependencies: {
          '@test/utils': '*',
        },
      }),
    },
    utils: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/utils',
        scripts: {
          build: 'echo $RANDOM > .out.txt',
        },
      }),
    },
  },
}

test('dependent tasks run', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(t.exists('packages/utils/.out.txt')).toBe(true)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "
        ::  lazyrepo  ::

        No config file found. Using defaults.
        packages/utils:build 💡 Searching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/utils:build 💡 Searching lazy.config.* took 1.00s
        packages/utils:build 💡 Searching **/* took 1.00s
        packages/utils:build 💡 Hashed 2/2 files in 1.00s
        packages/utils:build cache miss, no previous manifest found
        packages/utils:build  RUN echo $RANDOM > .out.txt in packages/utils
        packages/utils:build 
        packages/utils:build 
        packages/utils:build 💡 input manifest saved: packages/utils/.lazy/manifests/build
        packages/utils:build ✔ done in 1.00s
        packages/core:build 💡 Searching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/core:build 💡 Searching lazy.config.* took 1.00s
        packages/core:build 💡 Searching **/* took 1.00s
        packages/core:build 💡 Hashed 2/2 files in 1.00s
        packages/core:build cache miss, no previous manifest found
        packages/core:build  RUN echo $RANDOM > .out.txt in packages/core
        packages/core:build 
        packages/core:build 
        packages/core:build 💡 input manifest saved: packages/core/.lazy/manifests/build
        packages/core:build ✔ done in 1.00s
        ✔ Done in 1.00s
        "
      `)

      const mTimeCore = t.getMtime('packages/core/.out.txt')
      const mTimeUtils = t.getMtime('packages/utils/.out.txt')
      await new Promise((resolve) => setTimeout(resolve, 10))

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "
        ::  lazyrepo  ::

        No config file found. Using defaults.
        packages/utils:build 💡 Searching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/utils:build 💡 Searching lazy.config.* took 1.00s
        packages/utils:build 💡 Searching **/* took 1.00s
        packages/utils:build 💡 Hashed 0/2 files in 1.00s
        packages/utils:build 💡 input manifest saved: packages/utils/.lazy/manifests/build
        packages/utils:build ✔ cache hit ⚡️ in 1.00s
        packages/core:build 💡 Searching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/core:build 💡 Searching lazy.config.* took 1.00s
        packages/core:build 💡 Searching **/* took 1.00s
        packages/core:build 💡 Hashed 0/2 files in 1.00s
        packages/core:build 💡 input manifest saved: packages/core/.lazy/manifests/build
        packages/core:build ✔ cache hit ⚡️ in 1.00s

        >>> MAXIMUM LAZY
        ✔ Done in 1.00s
        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBe(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBe(mTimeUtils)
    },
  )
})
