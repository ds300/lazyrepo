import { LazyScript } from '../../index.js'
import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeWriteScript = (structure: Dir) => {
  let script = 'import {mkdirSync, writeFileSync} from "fs"\n'

  const processDir = (dir: Dir, path = '.') => {
    script += `mkdirSync(${JSON.stringify(path)}, { recursive: true })\n`
    for (const [name, value] of Object.entries(dir)) {
      if (typeof value === 'string') {
        script += `writeFileSync(${JSON.stringify(`${path}/${name}`)}, ${JSON.stringify(value)})\n`
      } else if (value) {
        processDir(value, `${path}/${name}`)
      }
    }
  }

  processDir(structure)
  return script
}

const makeDir = ({
  coreBuildScript = makeWriteScript({ 'core-out.txt': 'hello' }),
  utilsBuildScript = makeWriteScript({ 'utils-out.txt': 'hello' }),
  buildConfig = {
    cache: {
      inputs: {
        exclude: ['**/*.txt'],
      },
      outputs: ['**/*.txt'],
    },
  } as LazyScript,
} = {}) =>
  ({
    'lazy.config.js': makeConfigFile({
      scripts: {
        build: buildConfig,
      },
    }),
    packages: {
      core: {
        'index.js': 'console.log("hello world")',
        'core-build.js': coreBuildScript,
        'package.json': makePackageJson({
          type: 'module',
          name: '@test/core',
          scripts: {
            build: 'node core-build.js',
          },
          dependencies: {
            '@test/utils': '*',
          },
        }),
      },
      utils: {
        'index.js': 'console.log("hello world")',
        'utils-build.js': utilsBuildScript,
        'package.json': makePackageJson({
          type: 'module',
          name: '@test/utils',
          scripts: {
            build: 'node utils-build.js',
          },
        }),
      },
    },
    'package.json': makePackageJson({
      type: 'module',
      workspaces: ['packages/*'],
    }),
  } satisfies Dir)

const cleanup = (s: string) => {
  return s.replaceAll(/\t\d+(\.\d+)?\n/g, '\tTIMESTAMP\n')
}

test('cached files are reinstated on subsequent runs', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeDir({}),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--verbose'])
      expect(firstRun.status).toBe(0)
      expect(cleanup(t.read('packages/utils/.lazy/build/output-manifest.tsv')))
        .toMatchInlineSnapshot(`
        "packages/utils/utils-out.txt	TIMESTAMP
        "
      `)
      expect(cleanup(t.read('packages/core/.lazy/build/output-manifest.tsv')))
        .toMatchInlineSnapshot(`
        "packages/core/core-out.txt	TIMESTAMP
        "
      `)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 5/5 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node utils-build.js in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils finding files took 1.00s
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 6/6 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node core-build.js in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core finding files took 1.00s
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)

      const utilsOutMtime = t.getMtime('packages/utils/utils-out.txt')
      const coreOutMtime = t.getMtime('packages/core/core-out.txt')

      await new Promise((resolve) => setTimeout(resolve, 10))

      const secondRun = await t.exec(['build', '--verbose'])
      expect(secondRun.status).toBe(0)
      expect(t.getMtime('packages/utils/utils-out.txt')).toEqual(utilsOutMtime)
      expect(t.getMtime('packages/core/core-out.txt')).toEqual(coreOutMtime)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files took 1.00s
        build::packages/utils unchanged packages/utils/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files took 1.00s
        build::packages/core unchanged packages/core/core-out.txt
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core restored 1 output file
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)

      t.remove('packages/utils/utils-out.txt')
      t.remove('packages/core/core-out.txt')

      expect(t.exists('packages/utils/utils-out.txt')).toBe(false)
      expect(t.exists('packages/core/core-out.txt')).toBe(false)

      const thirdRun = await t.exec(['build', '--verbose'])
      expect(thirdRun.status).toBe(0)
      expect(t.exists('packages/utils/utils-out.txt')).toBe(true)
      expect(t.exists('packages/core/core-out.txt')).toBe(true)
      expect(t.getMtime('packages/utils/utils-out.txt')).toEqual(utilsOutMtime)
      expect(t.getMtime('packages/core/core-out.txt')).toEqual(coreOutMtime)
      expect(thirdRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files took 1.00s
        build::packages/utils restoring missing file: packages/utils/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 1/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files took 1.00s
        build::packages/core restoring missing file: packages/core/core-out.txt
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core restored 1 output file
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

test('files in other dirs can be cached', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeDir({
        coreBuildScript: `
          import {writeFileSync, mkdirSync} from 'fs'
          mkdirSync('../../root-outputs', {recursive: true})
          writeFileSync('../../root-outputs/core-out.txt', 'hello')
        `,
        utilsBuildScript: `
          import {writeFileSync, mkdirSync} from 'fs'
          mkdirSync('../../root-outputs', {recursive: true})
          writeFileSync('../../root-outputs/utils-out.txt', 'hello')
        `,
        buildConfig: {
          workspaceOverrides: {
            'packages/core': {
              cache: {
                outputs: ['<rootDir>/root-outputs/core-*'],
              },
            },
            'packages/utils': {
              cache: {
                outputs: ['<rootDir>/root-outputs/utils-*'],
              },
            },
          },
        },
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--verbose'])
      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 5/5 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node utils-build.js in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils finding files took 1.00s
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 6/6 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node core-build.js in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core finding files took 1.00s
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)
      expect(cleanup(t.read('packages/utils/.lazy/build/output-manifest.tsv')))
        .toMatchInlineSnapshot(`
        "root-outputs/utils-out.txt	TIMESTAMP
        "
      `)
      expect(cleanup(t.read('packages/core/.lazy/build/output-manifest.tsv')))
        .toMatchInlineSnapshot(`
        "root-outputs/core-out.txt	TIMESTAMP
        "
      `)

      t.remove('root-outputs')

      expect(t.exists('root-outputs/core-out.txt')).toBe(false)
      expect(t.exists('root-outputs/utils-out.txt')).toBe(false)
      const secondRun = await t.exec(['build', '--verbose'])
      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files took 1.00s
        build::packages/utils restoring missing file: root-outputs/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 1/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files took 1.00s
        build::packages/core restoring missing file: root-outputs/core-out.txt
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core restored 1 output file
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

test('it deletes files that match the output globs but were not there before', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeDir({}),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--verbose'])
      expect(firstRun.status).toBe(0)

      t.write('packages/utils/banana.txt', 'hello')
      expect(t.exists('packages/utils/banana.txt')).toBe(true)

      const secondRun = await t.exec(['build', '--verbose'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files took 1.00s
        build::packages/utils ⚠️ removing stale output file packages/utils/banana.txt
        build::packages/utils unchanged packages/utils/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files took 1.00s
        build::packages/core unchanged packages/core/core-out.txt
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core restored 1 output file
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)

      expect(t.exists('packages/utils/banana.txt')).toBe(false)
    },
  )
})

test('it allows output manifests to be empty', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      // don't create the output files
      structure: makeDir({ coreBuildScript: '', utilsBuildScript: '' }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--verbose'])
      expect(firstRun.status).toBe(0)

      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 5/5 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node utils-build.js in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils finding files took 1.00s
        build::packages/utils ⚠️ no output files found
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 5/5 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node core-build.js in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core finding files took 1.00s
        build::packages/core ⚠️ no output files found
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('it caches data in top-level tasks', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: {
        'package.json': makePackageJson({ type: 'module' }),
        'build.js': makeWriteScript({
          src: {
            'index.js': 'console.log("hello")',
            'cli.js': 'console.log("cli")',
            test: {
              'index.test.js': 'console.log("test")',
            },
          },
        }),
        'lazy.config.js': makeConfigFile({
          scripts: {
            compile: {
              execution: 'top-level',
              cache: {
                inputs: ['build.js'],
                outputs: ['src/**/*'],
              },
              baseCommand: 'node build.js',
            },
          },
        }),
      },
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['compile', '--verbose'])
      expect(firstRun.status).toBe(0)

      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> hashed 3/3 files in 1.00s
        compile::<rootDir> cache miss, no previous manifest found
        compile::<rootDir> RUN node build.js in ./
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> output manifest: .lazy/compile/output-manifest.tsv
        compile::<rootDir> ✔ done in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  0/1 cached
              Time:  1.00s

        "
      `)
      expect(cleanup(t.read('.lazy/compile/output-manifest.tsv'))).toMatchInlineSnapshot(`
        "src/cli.js	TIMESTAMP
        src/index.js	TIMESTAMP
        src/test/index.test.js	TIMESTAMP
        "
      `)

      t.remove('src')

      const secondRun = await t.exec(['compile', '--verbose'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> hashed 0/3 files in 1.00s
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> output log: .lazy/compile/output.log
        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> restoring missing file: src/cli.js
        compile::<rootDir> restoring missing file: src/index.js
        compile::<rootDir> restoring missing file: src/test/index.test.js
        compile::<rootDir> output manifest: .lazy/compile/output-manifest.tsv
        compile::<rootDir> restored 3 output files
        compile::<rootDir> ✔ cache hit ⚡️ in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  1/1 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})

function makeDir2({
  usesOutputFromCompile,
  usesOutputFromDependencies,
}: {
  usesOutputFromCompile: boolean
  usesOutputFromDependencies: boolean
}) {
  return {
    'package.json': makePackageJson({ type: 'module', workspaces: ['packages/*'] }),
    'build.js': makeWriteScript({
      src: {
        'index.js': 'console.log("hello")',
        'cli.js': 'console.log("cli")',
        test: {
          'index.test.js': 'console.log("test")',
        },
      },
    }),
    packages: {
      core: {
        'build.js': `
          import { mkdirSync, copyFileSync } from 'fs'
          mkdirSync('dist', {recursive: true})
          copyFileSync('../../src/cli.js', 'dist/cli.js')
        `,
        'package.json': makePackageJson({
          type: 'module',
          name: 'core',
          dependencies: {
            utils: 'workspace:*',
          },
          scripts: {
            build: 'node build.js',
            execute: 'node dist/cli.js',
          },
        }),
      },
      utils: {
        'build.js': `
          import { mkdirSync, copyFileSync } from 'fs'
          mkdirSync('dist/test', {recursive: true})
          copyFileSync('../../src/test/index.test.js', 'dist/test/index.test.js')
        `,
        'package.json': makePackageJson({
          type: 'module',
          name: 'utils',
          scripts: {
            build: 'node build.js',
            execute: 'node dist/test/index.test.js',
          },
        }),
      },
    },
    'lazy.config.js': makeConfigFile({
      scripts: {
        compile: {
          execution: 'top-level',
          cache: {
            inputs: ['build.js'],
            outputs: ['src/**/*'],
          },
          baseCommand: 'node build.js',
        },
        build: {
          runsAfter: { compile: { usesOutput: usesOutputFromCompile } },
          cache: {
            inputs: {
              exclude: ['dist/**/*'],
            },
            outputs: ['dist/**/*'],
            usesOutputFromDependencies: usesOutputFromDependencies,
          },
        },
      },
    }),
  }
}

test('it feeds cached outputs into downstream task manifests by default', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeDir2({ usesOutputFromCompile: true, usesOutputFromDependencies: true }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--verbose'])
      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> hashed 3/3 files in 1.00s
        compile::<rootDir> cache miss, no previous manifest found
        compile::<rootDir> RUN node build.js in ./
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> output manifest: .lazy/compile/output-manifest.tsv
        compile::<rootDir> ✔ done in 1.00s
        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 7/7 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN node build.js in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils finding files took 1.00s
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 8/8 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN node build.js in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core finding files took 1.00s
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  3 successful, 3 total
            Cached:  0/3 cached
              Time:  1.00s

        "
      `)

      const coreManifest = t.read('packages/core/.lazy/build/manifest.tsv')
      expect(cleanup(coreManifest)).toMatchInlineSnapshot(`
        "upstream package inputs	build::packages/utils	430cd68879caf4554062921c52520c98357a529b772bf5b71f5fe622c068413b
        file	lazy.config.js	2b90a79034045dfdebbf565ff3ba45b6a0d10a2aeec59edd204ca79a18473f73	TIMESTAMP
        file	package-lock.json	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855	TIMESTAMP
        file	packages/core/build.js	080fbff443a3bb8cc0b11e193af3ea5cd5aac7bbb11ea492104d00fff3a70ea1	TIMESTAMP
        file	packages/core/package.json	7af768974d777b23cde371e1e51b508368eba42f68c2009d47316107ca68041e	TIMESTAMP
        file	packages/utils/dist/test/index.test.js	b8d698bcd6ea71e0d7adf2bf5322f5cf96e0cb7d66d1a862ac1f110fdf0571d9	TIMESTAMP
        file	src/cli.js	02be9d61aa841f79756989bf537df8d4b3265157efcb1ecadbc33f79c12d73c0	TIMESTAMP
        file	src/index.js	425de7eed0bfd83eb049395063c45c38a5e1ab4db37dd6920ef88e869bdb616c	TIMESTAMP
        file	src/test/index.test.js	b8d698bcd6ea71e0d7adf2bf5322f5cf96e0cb7d66d1a862ac1f110fdf0571d9	TIMESTAMP
        "
      `)

      t.remove('src')

      const secondRun = await t.exec(['build', '--verbose'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> hashed 0/3 files in 1.00s
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> output log: .lazy/compile/output.log
        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> restoring missing file: src/cli.js
        compile::<rootDir> restoring missing file: src/index.js
        compile::<rootDir> restoring missing file: src/test/index.test.js
        compile::<rootDir> output manifest: .lazy/compile/output-manifest.tsv
        compile::<rootDir> restored 3 output files
        compile::<rootDir> ✔ cache hit ⚡️ in 1.00s
        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 3/7 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files took 1.00s
        build::packages/utils unchanged packages/utils/dist/test/index.test.js
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 3/8 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files took 1.00s
        build::packages/core unchanged packages/core/dist/cli.js
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core restored 1 output file
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  3 successful, 3 total
            Cached:  3/3 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
      expect(t.read('packages/core/.lazy/build/manifest.tsv')).toEqual(coreManifest)
    },
  )
})

test('it does not feed cached outputs into downstream script manifests if you say not to', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeDir2({ usesOutputFromCompile: false, usesOutputFromDependencies: true }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--verbose'])
      expect(firstRun.status).toBe(0)

      const coreManifest = t.read('packages/core/.lazy/build/manifest.tsv')
      expect(cleanup(coreManifest)).toMatchInlineSnapshot(`
        "upstream package inputs	build::packages/utils	4a21fdbe60149f0088295c29a4105b31f8c00bc850662cc42eecd9c536678173
        file	lazy.config.js	e1e03e6f864206e601d60509cbe920f83facdde45d726c6a291cfbc6b9a5c937	TIMESTAMP
        file	package-lock.json	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855	TIMESTAMP
        file	packages/core/build.js	080fbff443a3bb8cc0b11e193af3ea5cd5aac7bbb11ea492104d00fff3a70ea1	TIMESTAMP
        file	packages/core/package.json	7af768974d777b23cde371e1e51b508368eba42f68c2009d47316107ca68041e	TIMESTAMP
        file	packages/utils/dist/test/index.test.js	b8d698bcd6ea71e0d7adf2bf5322f5cf96e0cb7d66d1a862ac1f110fdf0571d9	TIMESTAMP
        "
      `)

      t.remove('src')

      const secondRun = await t.exec(['build', '--verbose'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> hashed 0/3 files in 1.00s
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> output log: .lazy/compile/output.log
        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> restoring missing file: src/cli.js
        compile::<rootDir> restoring missing file: src/index.js
        compile::<rootDir> restoring missing file: src/test/index.test.js
        compile::<rootDir> output manifest: .lazy/compile/output-manifest.tsv
        compile::<rootDir> restored 3 output files
        compile::<rootDir> ✔ cache hit ⚡️ in 1.00s
        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files took 1.00s
        build::packages/utils unchanged packages/utils/dist/test/index.test.js
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/5 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files took 1.00s
        build::packages/core unchanged packages/core/dist/cli.js
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core restored 1 output file
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  3 successful, 3 total
            Cached:  3/3 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
      expect(t.read('packages/core/.lazy/build/manifest.tsv')).toEqual(coreManifest)
    },
  )
})

test('it does not feed cached outputs into downstream task manifests if you say not to', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeDir2({ usesOutputFromCompile: false, usesOutputFromDependencies: false }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--verbose'])
      expect(firstRun.status).toBe(0)

      const coreManifest = t.read('packages/core/.lazy/build/manifest.tsv')
      expect(cleanup(coreManifest)).toMatchInlineSnapshot(`
        "upstream package inputs	build::packages/utils	4c8d0a38677a21d1f0dc47a0a7313c6b7d85b7cea02c502136a1160c8ebc7c12
        file	lazy.config.js	fefa5a6fba266289bf345f8ef1768f96cd4632dbcb95ba9b46db330b4854a76e	TIMESTAMP
        file	package-lock.json	e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855	TIMESTAMP
        file	packages/core/build.js	080fbff443a3bb8cc0b11e193af3ea5cd5aac7bbb11ea492104d00fff3a70ea1	TIMESTAMP
        file	packages/core/package.json	7af768974d777b23cde371e1e51b508368eba42f68c2009d47316107ca68041e	TIMESTAMP
        "
      `)

      t.remove('src')

      const secondRun = await t.exec(['build', '--verbose'])

      expect(secondRun.status).toBe(0)
      expect(secondRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> hashed 0/3 files in 1.00s
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> output log: .lazy/compile/output.log
        compile::<rootDir> finding files took 1.00s
        compile::<rootDir> restoring missing file: src/cli.js
        compile::<rootDir> restoring missing file: src/index.js
        compile::<rootDir> restoring missing file: src/test/index.test.js
        compile::<rootDir> output manifest: .lazy/compile/output-manifest.tsv
        compile::<rootDir> restored 3 output files
        compile::<rootDir> ✔ cache hit ⚡️ in 1.00s
        build::packages/utils finding files took 1.00s
        build::packages/utils hashed 0/4 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files took 1.00s
        build::packages/utils unchanged packages/utils/dist/test/index.test.js
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files took 1.00s
        build::packages/core hashed 0/4 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files took 1.00s
        build::packages/core unchanged packages/core/dist/cli.js
        build::packages/core output manifest: packages/core/.lazy/build/output-manifest.tsv
        build::packages/core restored 1 output file
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  3 successful, 3 total
            Cached:  3/3 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
      expect(t.read('packages/core/.lazy/build/manifest.tsv')).toEqual(coreManifest)
    },
  )
})
