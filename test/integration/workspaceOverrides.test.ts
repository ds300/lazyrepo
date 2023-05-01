import { DependentScript } from '../../index.js'
import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = (workspaceOverrides: DependentScript['workspaceOverrides']) =>
  ({
    packages: {
      core: {
        'index.js': 'console.log("hello world")',
        'package.json': makePackageJson({
          name: '@test/core',
          scripts: {
            build: 'echo $RANDOM > .out.core.txt',
            test: 'echo $RANDOM > .out.core.test.txt',
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
            build: 'echo $RANDOM > .out.utils.txt',
            test: 'echo $RANDOM > .out.utils.test.txt',
          },
        }),
      },
    },
    'lazy.config.js': makeConfigFile({
      scripts: {
        build: {
          cache: 'none',
          workspaceOverrides,
        },
      },
    }),
  } satisfies Dir)

test('cache config can be overridden', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({
        '@test/utils': {
          cache: { inputs: ['index.js'] },
        },
      }),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.core.txt')).toBe(true)
      expect(t.exists('packages/utils/.out.utils.txt')).toBe(true)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/index.js took 1.00s
        build::packages/utils Hashed 3/3 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN echo $RANDOM > .out.utils.txt in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core cache disabled
        build::packages/core RUN echo $RANDOM > .out.core.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      const mTimeCore = t.getMtime('packages/core/.out.core.txt')
      const mTimeUtils = t.getMtime('packages/utils/.out.utils.txt')
      await new Promise((resolve) => setTimeout(resolve, 10))

      const secondRun = await t.exec(['build'])

      // core runs again but utils does not because it has a cache config

      expect(secondRun.status).toBe(0)
      expect(t.getMtime('packages/core/.out.core.txt')).toBeGreaterThan(mTimeCore)
      expect(t.getMtime('packages/utils/.out.utils.txt')).toBe(mTimeUtils)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/index.js took 1.00s
        build::packages/utils Hashed 0/3 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core cache disabled
        build::packages/core RUN echo $RANDOM > .out.core.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  1/2 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('runsAfter can be overridden', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({
        '@test/utils': {
          runsAfter: { test: { in: 'self-only' } },
        },
      }),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)

      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        test::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        test::packages/utils Finding files matching lazy.config.* took 1.00s
        test::packages/utils Finding files matching packages/utils/**/* took 1.00s
        test::packages/utils Hashed 4/4 files in 1.00s
        test::packages/utils cache miss, no previous manifest found
        test::packages/utils RUN echo $RANDOM > .out.utils.test.txt in packages/utils
        test::packages/utils input manifest: packages/utils/.lazy/test/manifest.tsv
        test::packages/utils ✔ done in 1.00s
        build::packages/utils cache disabled
        build::packages/utils RUN echo $RANDOM > .out.utils.txt in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core cache disabled
        build::packages/core RUN echo $RANDOM > .out.core.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  3 successful, 3 total
            Cached:  0/3 cached
              Time:  1.00s

        "
      `)
      expect(t.exists('packages/core/.out.core.txt')).toBe(true)
      expect(t.exists('packages/core/.out.core.test.txt')).toBe(false)
      expect(t.exists('packages/utils/.out.utils.txt')).toBe(true)
      expect(t.exists('packages/utils/.out.utils.test.txt')).toBe(true)
    },
  )
})
