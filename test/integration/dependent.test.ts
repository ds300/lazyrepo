import { Dir, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const simpleDir = {
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
} satisfies Dir

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
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 3/3 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 3/3 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      const mTimeCore = t.getMtime('packages/core/.out.txt')
      const mTimeUtils = t.getMtime('packages/utils/.out.txt')
      await new Promise((resolve) => setTimeout(resolve, 10))

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 0/3 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build-6275696c64/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 0/3 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build-6275696c64/output.log
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBe(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBe(mTimeUtils)
    },
  )
})

test('adding an input file causes the task to re-run', async () => {
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

      let mTimeCore = t.getMtime('packages/core/.out.txt')
      let mTimeUtils = t.getMtime('packages/utils/.out.txt')
      await new Promise((resolve) => setTimeout(resolve, 10))

      // add a new file to the utils package
      t.write('packages/utils/new-file.txt', 'hello world')

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 1/4 files in 1.00s
        build::packages/utils cache miss, changes since last run:
        build::packages/utils + added file packages/utils/new-file.txt
        build::packages/utils 
        build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 0/3 files in 1.00s
        build::packages/core cache miss, changes since last run:
        build::packages/core ± changed upstream package inputs build::packages/utils
        build::packages/core 
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBeGreaterThan(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBeGreaterThan(mTimeUtils)

      // add a new file to the core package, only core should run
      mTimeCore = t.getMtime('packages/core/.out.txt')
      mTimeUtils = t.getMtime('packages/utils/.out.txt')

      t.write('packages/core/new-file.txt', 'hello world')

      const thirdRun = await t.exec(['build'])

      expect(thirdRun.status).toBe(0)
      expect(thirdRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build-6275696c64/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 1/4 files in 1.00s
        build::packages/core cache miss, changes since last run:
        build::packages/core + added file packages/core/new-file.txt
        build::packages/core 
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  1/2 cached
              Time:  1.00s

        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBeGreaterThan(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBe(mTimeUtils)
    },
  )
})

test('changing an input file causes the task to re-run', async () => {
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

      let mTimeCore = t.getMtime('packages/core/.out.txt')
      let mTimeUtils = t.getMtime('packages/utils/.out.txt')
      await new Promise((resolve) => setTimeout(resolve, 10))

      // change utils/index.js
      t.write('packages/utils/index.js', '// hello world')

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 1/3 files in 1.00s
        build::packages/utils cache miss, changes since last run:
        build::packages/utils ± changed file packages/utils/index.js
        build::packages/utils 
        build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 0/3 files in 1.00s
        build::packages/core cache miss, changes since last run:
        build::packages/core ± changed upstream package inputs build::packages/utils
        build::packages/core 
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBeGreaterThan(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBeGreaterThan(mTimeUtils)

      // add a new file to the core package, only core should run
      mTimeCore = t.getMtime('packages/core/.out.txt')
      mTimeUtils = t.getMtime('packages/utils/.out.txt')

      // change core/index.js
      t.write('packages/core/index.js', '// hello world')

      const thirdRun = await t.exec(['build'])

      expect(thirdRun.status).toBe(0)
      expect(thirdRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 0/3 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build-6275696c64/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 1/3 files in 1.00s
        build::packages/core cache miss, changes since last run:
        build::packages/core ± changed file packages/core/index.js
        build::packages/core 
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  1/2 cached
              Time:  1.00s

        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBeGreaterThan(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBe(mTimeUtils)
    },
  )
})

test('deleting an input file causes the task to re-run', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const firstRun = await t.exec(['build'])

      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 3/3 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 3/3 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(t.exists('packages/utils/.out.txt')).toBe(true)

      let mTimeCore = t.getMtime('packages/core/.out.txt')
      let mTimeUtils = t.getMtime('packages/utils/.out.txt')
      await new Promise((resolve) => setTimeout(resolve, 10))

      // remove utils/index.js
      t.remove('packages/utils/index.js')

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 1/2 files in 1.00s
        build::packages/utils cache miss, changes since last run:
        build::packages/utils - removed file packages/utils/index.js
        build::packages/utils 
        build::packages/utils RUN echo $RANDOM > .out.txt in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 0/3 files in 1.00s
        build::packages/core cache miss, changes since last run:
        build::packages/core ± changed upstream package inputs build::packages/utils
        build::packages/core 
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBeGreaterThan(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBeGreaterThan(mTimeUtils)

      // add a new file to the core package, only core should run
      mTimeCore = t.getMtime('packages/core/.out.txt')
      mTimeUtils = t.getMtime('packages/utils/.out.txt')

      // change core/index.js
      t.remove('packages/core/index.js')

      const thirdRun = await t.exec(['build'])

      expect(thirdRun.status).toBe(0)
      expect(thirdRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 0/2 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build-6275696c64/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build-6275696c64/output.log
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 1/2 files in 1.00s
        build::packages/core cache miss, changes since last run:
        build::packages/core - removed file packages/core/index.js
        build::packages/core 
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build-6275696c64/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  1/2 cached
              Time:  1.00s

        "
      `)

      expect(t.getMtime('packages/core/.out.txt')).toBeGreaterThan(mTimeCore)
      expect(t.getMtime('packages/utils/.out.txt')).toBe(mTimeUtils)
    },
  )
})

test('when an upstream task fails the downstream tasks do not run', async () => {
  const dir: Dir = {
    packages: {
      core: simpleDir.packages.core,
      utils: {
        'index.js': 'console.log("hello world")',
        'package.json': makePackageJson({
          name: '@test/utils',
          scripts: {
            build: 'echo $RANDOM > .out.txt && exit 1',
          },
        }),
      },
    },
  }

  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: dir,
    },
    async (t) => {
      const firstRun = await t.exec(['build'], {
        expectError: true,
      })

      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        No config files found, using default configuration.

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 3/3 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN echo $RANDOM > .out.txt && exit 1 in packages/utils
        build::packages/utils  ERROR OUTPUT 

        build::packages/utils ∙ ERROR ∙ failed

        Failed tasks: build::packages/utils

             Tasks:  0 successful, 1 failed, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      expect(firstRun.status).toBe(1)
      expect(t.exists('packages/utils/.out.txt')).toBe(true)
      expect(t.exists('packages/core/.out.txt')).toBe(false)
    },
  )
})
