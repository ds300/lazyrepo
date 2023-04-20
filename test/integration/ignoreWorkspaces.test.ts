import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = ({
  buildCommand = 'echo $RANDOM > out.txt',
  ignoreWorkspaces = ['packages/utils'],
} = {}): Dir => ({
  'lazy.config.js': makeConfigFile({
    tasks: {
      build: {
        cache: {
          inputs: {
            exclude: ['out.txt'],
          },
        },
        execution: 'independent',
      },
    },
    ignoreWorkspaces,
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

test('a workspace can be ignored and things will not run in it', async () => {
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
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN echo $RANDOM > out.txt in packages/core
        build::packages/core input manifest saved: packages/core/.lazy/manifests/build
        build::packages/core ✔ done in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  0/1 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('a workspace can be ignored with a glob pattern', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({ ignoreWorkspaces: ['packages/c*'] }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(true)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN echo $RANDOM > out.txt in packages/utils
        build::packages/utils input manifest saved: packages/utils/.lazy/manifests/build
        build::packages/utils ✔ done in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  0/1 cached
              Time:  1.00s

        "
      `)
    },
  )
})
