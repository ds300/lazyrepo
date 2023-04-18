import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = (): Dir => ({
  'lazy.config.js': makeConfigFile({
    tasks: {
      build: {
        execution: 'top-level',
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

test('running a top-level tasks works', async () => {
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
        "lazyrepo @0.0.0-test
        --------------------
        Loaded config file: lazy.config.js

        build::<rootDir> Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::<rootDir> Finding files matching lazy.config.* took 1.00s
        build::<rootDir> Finding files matching **/* took 1.00s
        build::<rootDir> Hashed 8/8 files in 1.00s
        build::<rootDir> cache miss, no previous manifest found
        build::<rootDir> RUN echo hello > out.txt in 
        build::<rootDir> input manifest saved: .lazy/manifests/build
        build::<rootDir> ✔ done in 1.00s

        \t   Tasks:	1 successful, 1 Total
        \t  Cached:	0 cached, 1 Total
        \tLaziness:	0%
        \t    Time:\t1.00s
        "
      `)

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo @0.0.0-test
        --------------------
        Loaded config file: lazy.config.js

        build::<rootDir> Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::<rootDir> Finding files matching lazy.config.* took 1.00s
        build::<rootDir> Finding files matching **/* took 1.00s
        build::<rootDir> Hashed 0/8 files in 1.00s
        build::<rootDir> input manifest saved: .lazy/manifests/build
        build::<rootDir> ✔ cache hit ⚡️ in 1.00s

        \t   Tasks:	1 successful, 1 Total
        \t  Cached:	1 cached, 1 Total
        \tLaziness:	>>> MAXIMUM LAZY
        \t    Time:\t1.00s
        "
      `)
    },
  )
})
