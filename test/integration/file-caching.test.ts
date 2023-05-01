import { LazyScript } from '../../index.js'
import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeWriteScript = (structure: Dir) => {
  let script = ''

  const processDir = (dir: Dir, path = '$PWD') => {
    script += `mkdir -p ${path}\n`
    for (const [name, value] of Object.entries(dir)) {
      if (typeof value === 'string') {
        script += `echo '${value}' > ${path}/${name}\n`
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
        'core-build.sh': coreBuildScript,
        'package.json': makePackageJson({
          name: '@test/core',
          scripts: {
            build: 'sh core-build.sh',
          },
          dependencies: {
            '@test/utils': '*',
          },
        }),
      },
      utils: {
        'index.js': 'console.log("hello world")',
        'utils-build.sh': utilsBuildScript,
        'package.json': makePackageJson({
          name: '@test/utils',
          scripts: {
            build: 'sh utils-build.sh',
          },
        }),
      },
    },
  } satisfies Dir)

const cleanup = (s: string) => {
  return s.replaceAll(/\d+/g, 'TIMESTAMP')
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

        build::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils finding files matching lazy.config.* took 1.00s
        build::packages/utils finding files matching packages/utils/**/* took 1.00s
        build::packages/utils hashed 5/5 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN sh utils-build.sh in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils finding files matching packages/utils/**/*.txt took 1.00s
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 6/6 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN sh core-build.sh in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core finding files matching packages/core/**/*.txt took 1.00s
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

        build::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils finding files matching lazy.config.* took 1.00s
        build::packages/utils finding files matching packages/utils/**/* took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files matching packages/utils/**/*.txt took 1.00s
        build::packages/utils unchanged packages/utils/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 0/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files matching packages/core/**/*.txt took 1.00s
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

        build::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils finding files matching lazy.config.* took 1.00s
        build::packages/utils finding files matching packages/utils/**/* took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files matching packages/utils/**/*.txt took 1.00s
        build::packages/utils restoring missing file: packages/utils/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 1/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files matching packages/core/**/*.txt took 1.00s
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
        coreBuildScript:
          'mkdir -p ../../root-outputs && echo hello > ../../root-outputs/core-out.txt',
        utilsBuildScript:
          'mkdir -p ../../root-outputs && echo hello > ../../root-outputs/utils-out.txt',
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

        build::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils finding files matching lazy.config.* took 1.00s
        build::packages/utils finding files matching packages/utils/**/* took 1.00s
        build::packages/utils hashed 5/5 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN sh utils-build.sh in packages/utils
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils finding files matching root-outputs/utils-* took 1.00s
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils ✔ done in 1.00s
        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 6/6 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN sh core-build.sh in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core finding files matching root-outputs/core-* took 1.00s
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

        build::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils finding files matching lazy.config.* took 1.00s
        build::packages/utils finding files matching packages/utils/**/* took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files matching root-outputs/utils-* took 1.00s
        build::packages/utils restoring missing file: root-outputs/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 1/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files matching root-outputs/core-* took 1.00s
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

        build::packages/utils finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils finding files matching lazy.config.* took 1.00s
        build::packages/utils finding files matching packages/utils/**/* took 1.00s
        build::packages/utils hashed 0/5 files in 1.00s
        build::packages/utils input manifest: packages/utils/.lazy/build/manifest.tsv
        build::packages/utils output log: packages/utils/.lazy/build/output.log
        build::packages/utils finding files matching packages/utils/**/*.txt took 1.00s
        build::packages/utils ⚠️ removing stale output file packages/utils/banana.txt
        build::packages/utils unchanged packages/utils/utils-out.txt
        build::packages/utils output manifest: packages/utils/.lazy/build/output-manifest.tsv
        build::packages/utils restored 1 output file
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 0/6 files in 1.00s
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core output log: packages/core/.lazy/build/output.log
        build::packages/core finding files matching packages/core/**/*.txt took 1.00s
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

test('it caches data in top-level tasks', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: {
        'package.json': makePackageJson({ type: 'module' }),
        'build.sh': makeWriteScript({
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
                inputs: ['build.sh'],
                outputs: ['src/**/*'],
              },
              baseCommand: 'sh build.sh',
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

        compile::<rootDir> finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        compile::<rootDir> finding files matching lazy.config.* took 1.00s
        compile::<rootDir> finding files matching build.sh took 1.00s
        compile::<rootDir> hashed 3/3 files in 1.00s
        compile::<rootDir> cache miss, no previous manifest found
        compile::<rootDir> RUN sh build.sh in 
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> finding files matching src/**/* took 1.00s
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

        compile::<rootDir> finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        compile::<rootDir> finding files matching lazy.config.* took 1.00s
        compile::<rootDir> finding files matching build.sh took 1.00s
        compile::<rootDir> hashed 0/3 files in 1.00s
        compile::<rootDir> input manifest: .lazy/compile/manifest.tsv
        compile::<rootDir> output log: .lazy/compile/output.log
        compile::<rootDir> finding files matching src/**/* took 1.00s
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
