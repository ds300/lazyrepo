import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeScript = () => `
  require('fs').writeFileSync('out.txt', 'hey' + Math.random())
  async function run() {
    if (process.argv.includes('--sleep')) {
      await new Promise(r => setTimeout(r, 100))
    }
    if (process.argv.includes('--fail')) {
      process.exit(1)
    }
  }
  run()
`

const makeDir = ({ buildCommand = 'node index.js' } = {}): Dir => ({
  'lazy.config.js': makeConfigFile({
    scripts: {
      build: {
        cache: {
          inputs: {
            exclude: ['out.txt'],
          },
        },
        execution: 'independent',
      },
    },
  }),
  packages: {
    core: {
      'index.js': makeScript(),
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
      'index.js': makeScript(),
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
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node index.js in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s
        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node index.js in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/4 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core ✔ cache hit ⚡️ in 1.00s
        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

test('running independent tasks works in parallel', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({ buildCommand: 'node index.js --sleep' }),
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
      ).toBeLessThan(80)
    },
  )

  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({ buildCommand: 'node index.js --sleep' }),
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

test('when a task fails it continues running the others', () => {
  return runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({
        buildCommand: 'node index.js --fail',
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      const firstRun = await t.exec(['build'], {
        expectError: true,
      })

      expect(firstRun.status).toBe(1)
      expect(t.exists('packages/core/out.txt')).toBe(true)
      expect(t.exists('packages/utils/out.txt')).toBe(true)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node index.js --fail in packages/core
        build::packages/core  ERROR OUTPUT 

        build::packages/core ∙ ERROR ∙ failed
        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node index.js --fail in packages/utils
        build::packages/utils  ERROR OUTPUT 

        build::packages/utils ∙ ERROR ∙ failed

        Failed tasks: build::packages/core, build::packages/utils

             Tasks:  0 successful, 2 failed, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)
    },
  )
})
