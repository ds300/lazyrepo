import { LazyScript } from '../../index.js'
import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = (
  build: LazyScript,
  { coreBuild = 'node -e "console.log(2)"', utilsBuild = 'node -e "console.log(0)"' } = {},
) =>
  ({
    'lazy.config.js': makeConfigFile({
      scripts: {
        build,
      },
    }),
    packages: {
      core: {
        'index.js': 'console.log("hello world")',
        'package.json': makePackageJson({
          name: '@test/core',
          scripts: {
            build: coreBuild,
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
            build: utilsBuild,
          },
        }),
      },
    },
  } satisfies Dir)

test('log outputs are stored on disk', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({}),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.lazy/build/output.log')).toBe(true)
      expect(t.exists('packages/utils/.lazy/build/output.log')).toBe(true)
      expect(t.read('packages/core/.lazy/build/output.log')).toMatchInlineSnapshot(`
        "2
        "
      `)
      expect(t.read('packages/utils/.lazy/build/output.log')).toMatchInlineSnapshot(`
        "0
        "
      `)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils 0
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(2)" in packages/core
        build::packages/core 2
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('new-only makes it so that the output is suppressed on cache hits', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({
        logMode: 'new-only',
      }),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils 0
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(2)" in packages/core
        build::packages/core 2
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

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

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/4 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)

      expect(t.read('packages/core/.lazy/build/output.log')).toMatchInlineSnapshot(`
        "2
        "
      `)
      expect(t.read('packages/utils/.lazy/build/output.log')).toMatchInlineSnapshot(`
        "0
        "
      `)
    },
  )
})

test('The default mode is new-only the output is suppressed on cache hits', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({
        logMode: undefined,
      }),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])
      expect(firstRun.status).toBe(0)

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/4 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)

      expect(t.read('packages/core/.lazy/build/output.log')).toMatchInlineSnapshot(`
        "2
        "
      `)
      expect(t.read('packages/utils/.lazy/build/output.log')).toMatchInlineSnapshot(`
        "0
        "
      `)
    },
  )
})

test('in full mode the cached output is replayed', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({
        logMode: 'full',
      }),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])
      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils 0
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(2)" in packages/core
        build::packages/core 2
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

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

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils  CACHED OUTPUT 
        0

        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/4 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core  CACHED OUTPUT 
        2

        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

test('in none mode the output is never logged', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({
        logMode: 'none',
      }),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])
      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(2)" in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core ✔ done in 1.00s

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

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/4 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

test('in errors-only mode the output is never logged if things are successful', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir({
        logMode: 'errors-only',
      }),
    },
    async (t) => {
      const firstRun = await t.exec(['build'])
      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(2)" in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core ✔ done in 1.00s

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

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/4 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

test('in errors-only mode the output is logged if things fail', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir(
        {
          logMode: 'errors-only',
        },
        {
          coreBuild: 'node -e "console.log(1)" && exit 1',
        },
      ),
    },
    async (t) => {
      const firstRun = await t.exec(['build'], { expectError: true })
      expect(firstRun.status).toBe(1)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(1)" && exit 1 in packages/core
        build::packages/core  ERROR OUTPUT 
        1

        build::packages/core ∙ ERROR ∙ failed

        Failed tasks: build::packages/core

             Tasks:  1 successful, 1 failed, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      const secondRun = await t.exec(['build'], { expectError: true })

      expect(secondRun.status).toBe(1)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(1)" && exit 1 in packages/core
        build::packages/core  ERROR OUTPUT 
        1

        build::packages/core ∙ ERROR ∙ failed

        Failed tasks: build::packages/core

             Tasks:  1 successful, 1 failed, 2 total
            Cached:  1/2 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('in new-only mode it logs errors', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir(
        {
          logMode: 'new-only',
        },
        {
          coreBuild: 'node -e "console.log(1)" && exit 1',
        },
      ),
    },
    async (t) => {
      const firstRun = await t.exec(['build'], { expectError: true })
      expect(firstRun.status).toBe(1)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils 0
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(1)" && exit 1 in packages/core
        build::packages/core 1
        build::packages/core  ERROR OUTPUT 
        1

        build::packages/core ∙ ERROR ∙ failed

        Failed tasks: build::packages/core

             Tasks:  1 successful, 1 failed, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      const secondRun = await t.exec(['build'], { expectError: true })

      expect(secondRun.status).toBe(1)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(1)" && exit 1 in packages/core
        build::packages/core 1
        build::packages/core  ERROR OUTPUT 
        1

        build::packages/core ∙ ERROR ∙ failed

        Failed tasks: build::packages/core

             Tasks:  1 successful, 1 failed, 2 total
            Cached:  1/2 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('in full mode it logs errors', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: makeDir(
        {
          logMode: 'full',
        },
        {
          coreBuild: 'node -e "console.log(1)" && exit 1',
        },
      ),
    },
    async (t) => {
      const firstRun = await t.exec(['build'], { expectError: true })
      expect(firstRun.status).toBe(1)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node -e "console.log(0)" in packages/utils
        build::packages/utils 0
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(1)" && exit 1 in packages/core
        build::packages/core 1
        build::packages/core  ERROR OUTPUT 
        1

        build::packages/core ∙ ERROR ∙ failed

        Failed tasks: build::packages/core

             Tasks:  1 successful, 1 failed, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      const secondRun = await t.exec(['build'], { expectError: true })

      expect(secondRun.status).toBe(1)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils  CACHED OUTPUT 
        0

        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node -e "console.log(1)" && exit 1 in packages/core
        build::packages/core 1
        build::packages/core  ERROR OUTPUT 
        1

        build::packages/core ∙ ERROR ∙ failed

        Failed tasks: build::packages/core

             Tasks:  1 successful, 1 failed, 2 total
            Cached:  1/2 cached
              Time:  1.00s

        "
      `)
    },
  )
})
