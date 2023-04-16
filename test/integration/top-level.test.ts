import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = (): Dir => ({
  'lazy.config.js': makeConfigFile({
    tasks: {
      build: {
        runType: 'top-level',
        cache: {
          inputs: {
            exclude: ['out.txt'],
          },
        },
        baseCommand: 'echo hello > out.txt',
      },
    },
  }),
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/core',
        dependencies: {
          '@test/utils': '*',
        },
      }),
    },
    utils: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/utils',
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
      expect(t.exists('/out.txt')).toBe(false)
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('/out.txt')).toBe(true)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "Using config file: lazy.config.js
        <rootDir>:build Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        <rootDir>:build Finding files matching lazy.config.* took 1.00s
        <rootDir>:build Finding files matching **/* took 1.00s
        <rootDir>:build Hashed 7/7 files in 1.00s
        <rootDir>:build cache miss, no previous manifest found
        <rootDir>:build RUN echo hello > out.txt in 
        <rootDir>:build input manifest saved: .lazy/manifests/build
        <rootDir>:build ✔ done in 1.00s
        "
      `)

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "Using config file: lazy.config.js
        <rootDir>:build Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        <rootDir>:build Finding files matching lazy.config.* took 1.00s
        <rootDir>:build Finding files matching **/* took 1.00s
        <rootDir>:build Hashed 0/7 files in 1.00s
        <rootDir>:build input manifest saved: .lazy/manifests/build
        <rootDir>:build ✔ cache hit ⚡️ in 1.00s

        >>> MAXIMUM LAZY
        "
      `)
    },
  )
})
