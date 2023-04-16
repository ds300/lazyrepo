import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = ({ buildCommand = 'echo $RANDOM > out.txt' } = {}): Dir => ({
  'lazy.config.js': makeConfigFile({
    tasks: {
      build: {
        cache: {
          inputs: {
            exclude: ['out.txt'],
          },
        },
        runType: 'independent',
      },
    },
  }),
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/core',
        scripts: {
          build: buildCommand,
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
          build: buildCommand,
        },
      }),
    },
  },
})

test('running independent tasks works', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir(),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/out.txt')).toBe(true)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "Using config file: lazy.config.js
        packages/core:build Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/core:build Finding files matching lazy.config.* took 1.00s
        packages/core:build Finding files matching packages/core/**/* took 1.00s
        packages/core:build Hashed 3/3 files in 1.00s
        packages/core:build cache miss, no previous manifest found
        packages/core:build RUN echo $RANDOM > out.txt in packages/core
        packages/core:build input manifest saved: packages/core/.lazy/manifests/build
        packages/core:build ✔ done in 1.00s
        packages/utils:build Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/utils:build Finding files matching lazy.config.* took 1.00s
        packages/utils:build Finding files matching packages/utils/**/* took 1.00s
        packages/utils:build Hashed 3/3 files in 1.00s
        packages/utils:build cache miss, no previous manifest found
        packages/utils:build RUN echo $RANDOM > out.txt in packages/utils
        packages/utils:build input manifest saved: packages/utils/.lazy/manifests/build
        packages/utils:build ✔ done in 1.00s
        "
      `)

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "Using config file: lazy.config.js
        packages/core:build Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/core:build Finding files matching lazy.config.* took 1.00s
        packages/core:build Finding files matching packages/core/**/* took 1.00s
        packages/core:build Hashed 0/3 files in 1.00s
        packages/core:build input manifest saved: packages/core/.lazy/manifests/build
        packages/core:build ✔ cache hit ⚡️ in 1.00s
        packages/utils:build Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        packages/utils:build Finding files matching lazy.config.* took 1.00s
        packages/utils:build Finding files matching packages/utils/**/* took 1.00s
        packages/utils:build Hashed 0/3 files in 1.00s
        packages/utils:build input manifest saved: packages/utils/.lazy/manifests/build
        packages/utils:build ✔ cache hit ⚡️ in 1.00s

        >>> MAXIMUM LAZY
        "
      `)
    },
  )
})

test('running independent tasks works in parallel', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({ buildCommand: 'echo $RANDOM > out.txt && sleep 0.1' }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      const firstRun = await t.exec(['build'], {
        env: {
          __test__FORCE_PARALLEL: 'true',
        },
      })

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/out.txt')).toBe(true)
      expect(t.exists('packages/utils/out.txt')).toBe(true)

      expect(
        Math.abs(t.getMtime('packages/utils/out.txt') - t.getMtime('packages/core/out.txt')),
      ).toBeLessThan(50)
    },
  )

  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({ buildCommand: 'echo $RANDOM > out.txt && sleep 0.1' }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      const firstRun = await t.exec(['build'], {})
      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/out.txt')).toBe(true)
      expect(t.exists('packages/utils/out.txt')).toBe(true)

      // running again without the parallel flag should yield a big gap between tasks
      expect(
        Math.abs(t.getMtime('packages/utils/out.txt') - t.getMtime('packages/core/out.txt')),
      ).toBeGreaterThan(100)
    },
  )
})
