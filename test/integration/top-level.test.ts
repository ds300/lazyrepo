import { LazyScript } from '../../index.js'
import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = (buildConfig?: LazyScript): Dir => ({
  'lazy.config.js': makeConfigFile({
    scripts: {
      build: {
        execution: 'top-level',
        cache: {
          inputs: {
            exclude: ['out.txt'],
          },
        },
        baseCommand: 'echo hello > out.txt',
        ...buildConfig,
      },
    },
  }),
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/core',
        scripts: {
          compile: 'echo hello > out.txt',
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
          compile: 'echo hello > out.txt',
        },
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
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::<rootDir> finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::<rootDir> finding files matching lazy.config.* took 1.00s
        build::<rootDir> finding files matching **/* took 1.00s
        build::<rootDir> hashed 8/8 files in 1.00s
        build::<rootDir> cache miss, no previous manifest found
        build::<rootDir> RUN echo hello > out.txt in 
        build::<rootDir> input manifest: .lazy/build/manifest.tsv
        build::<rootDir> ✔ done in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  0/1 cached
              Time:  1.00s

        "
      `)

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::<rootDir> finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::<rootDir> finding files matching lazy.config.* took 1.00s
        build::<rootDir> finding files matching **/* took 1.00s
        build::<rootDir> hashed 0/8 files in 1.00s
        build::<rootDir> input manifest: .lazy/build/manifest.tsv
        build::<rootDir> output log: .lazy/build/output.log
        build::<rootDir> ✔ cache hit ⚡️ in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  1/1 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

test('top-level tasks can depend on other tasks', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({
        runsAfter: {
          compile: {},
        },
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('/out.txt')).toBe(false)
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('/out.txt')).toBe(true)
      expect(t.exists('/packages/utils/out.txt')).toBe(true)
      expect(t.exists('/packages/core/out.txt')).toBe(true)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        compile::packages/utils finding files matching lazy.config.* took 1.00s
        compile::packages/utils finding files matching packages/utils/**/* took 1.00s
        compile::packages/utils hashed 4/4 files in 1.00s
        compile::packages/utils cache miss, no previous manifest found
        compile::packages/utils RUN echo hello > out.txt in packages/utils
        compile::packages/utils input manifest: packages/utils/.lazy/compile/manifest.tsv
        compile::packages/utils ✔ done in 1.00s
        compile::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        compile::packages/core finding files matching lazy.config.* took 1.00s
        compile::packages/core finding files matching packages/core/**/* took 1.00s
        compile::packages/core hashed 4/4 files in 1.00s
        compile::packages/core cache miss, no previous manifest found
        compile::packages/core RUN echo hello > out.txt in packages/core
        compile::packages/core input manifest: packages/core/.lazy/compile/manifest.tsv
        compile::packages/core ✔ done in 1.00s
        build::<rootDir> finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::<rootDir> finding files matching lazy.config.* took 1.00s
        build::<rootDir> finding files matching **/* took 1.00s
        build::<rootDir> hashed 10/10 files in 1.00s
        build::<rootDir> cache miss, no previous manifest found
        build::<rootDir> RUN echo hello > out.txt in 
        build::<rootDir> input manifest: .lazy/build/manifest.tsv
        build::<rootDir> ✔ done in 1.00s

             Tasks:  3 successful, 3 total
            Cached:  0/3 cached
              Time:  1.00s

        "
      `)

      const secondRun = await t.exec(['build'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        compile::packages/utils finding files matching lazy.config.* took 1.00s
        compile::packages/utils finding files matching packages/utils/**/* took 1.00s
        compile::packages/utils hashed 1/5 files in 1.00s
        compile::packages/utils cache miss, changes since last run:
        compile::packages/utils + added file packages/utils/out.txt
        compile::packages/utils 
        compile::packages/utils RUN echo hello > out.txt in packages/utils
        compile::packages/utils input manifest: packages/utils/.lazy/compile/manifest.tsv
        compile::packages/utils ✔ done in 1.00s
        compile::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        compile::packages/core finding files matching lazy.config.* took 1.00s
        compile::packages/core finding files matching packages/core/**/* took 1.00s
        compile::packages/core hashed 1/5 files in 1.00s
        compile::packages/core cache miss, changes since last run:
        compile::packages/core ± changed upstream package inputs compile::packages/utils
        compile::packages/core + added file packages/core/out.txt
        compile::packages/core 
        compile::packages/core RUN echo hello > out.txt in packages/core
        compile::packages/core input manifest: packages/core/.lazy/compile/manifest.tsv
        compile::packages/core ✔ done in 1.00s
        build::<rootDir> finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::<rootDir> finding files matching lazy.config.* took 1.00s
        build::<rootDir> finding files matching **/* took 1.00s
        build::<rootDir> hashed 2/10 files in 1.00s
        build::<rootDir> input manifest: .lazy/build/manifest.tsv
        build::<rootDir> output log: .lazy/build/output.log
        build::<rootDir> ✔ cache hit ⚡️ in 1.00s

             Tasks:  3 successful, 3 total
            Cached:  1/3 cached
              Time:  1.00s

        "
      `)
    },
  )
})
