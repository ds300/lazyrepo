import { Dir, makeConfigFile, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = ({
  baseCommand = 'echo $RANDOM > out.txt',
  utilsBuildCommand = 'yarn run --top-level lazy inherit',
  coreBuildCommand = 'lazy inherit',
} = {}) =>
  ({
    'lazy.config.js': makeConfigFile({
      scripts: {
        build: {
          baseCommand,
          cache: {
            inputs: {
              exclude: ['out.txt'],
            },
          },
        },
      },
    }),
    'build.js': `console.log('secret', process.env.SECRET_VAR); console.log('args', process.argv.slice(2))`,
    packages: {
      core: {
        'index.js': 'console.log("hello world")',
        'package.json': makePackageJson({
          name: '@test/core',
          scripts: {
            build: coreBuildCommand,
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
            build: utilsBuildCommand,
          },
        }),
      },
    },
  } satisfies Dir)

test('lazy inherit looks up the command in the config file', async () => {
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

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN echo $RANDOM > out.txt in packages/utils
        build::packages/utils input manifest saved: packages/utils/.lazy/manifests/build
        build::packages/utils ✔ done in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN echo $RANDOM > out.txt in packages/core
        build::packages/core input manifest saved: packages/core/.lazy/manifests/build
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

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 0/4 files in 1.00s
        build::packages/utils input manifest saved: packages/utils/.lazy/manifests/build
        build::packages/utils ✔ cache hit ⚡️ in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 0/4 files in 1.00s
        build::packages/core input manifest saved: packages/core/.lazy/manifests/build
        build::packages/core ✔ cache hit ⚡️ in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  2/2 >>> MAXIMUM LAZY
              Time:  1.00s

        "
      `)
    },
  )
})
test('lazy inherit supports setting env vars', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({
        baseCommand: 'node <rootDir>/build.js > out.txt',
        coreBuildCommand: 'SECRET_VAR=sup lazy inherit',
        utilsBuildCommand: 'SECRET_VAR=howdy lazy inherit',
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      const run = await t.exec(['build'])
      expect(run.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/utils Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/utils Finding files matching lazy.config.* took 1.00s
        build::packages/utils Finding files matching packages/utils/**/* took 1.00s
        build::packages/utils Hashed 4/4 files in 1.00s
        build::packages/utils cache miss, no previous manifest found
        build::packages/utils RUN SECRET_VAR=howdy node __ROOT_DIR__/build.js > out.txt in packages/utils
        build::packages/utils input manifest saved: packages/utils/.lazy/manifests/build
        build::packages/utils ✔ done in 1.00s
        build::packages/core Finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core Finding files matching lazy.config.* took 1.00s
        build::packages/core Finding files matching packages/core/**/* took 1.00s
        build::packages/core Hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN SECRET_VAR=sup node __ROOT_DIR__/build.js > out.txt in packages/core
        build::packages/core input manifest saved: packages/core/.lazy/manifests/build
        build::packages/core ✔ done in 1.00s

             Tasks:  2 successful, 2 total
            Cached:  0/2 cached
              Time:  1.00s

        "
      `)
      expect(t.read('packages/core/out.txt')).toMatchInlineSnapshot(`
        "secret sup
        args []
        "
      `)
      expect(t.read('packages/utils/out.txt')).toMatchInlineSnapshot(`
        "secret howdy
        args []
        "
      `)
    },
  )
})

test('lazy inherit supports passing args', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({
        baseCommand: `node <rootDir>/build.js > out.txt`,
        coreBuildCommand: 'lazy inherit --foo --bar',
        utilsBuildCommand: 'lazy inherit --howdy --sup',
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      await t.exec(['build'])
      expect(t.read('packages/core/out.txt')).toMatchInlineSnapshot(`
        "secret undefined
        args [ '--foo', '--bar' ]
        "
      `)
      expect(t.read('packages/utils/out.txt')).toMatchInlineSnapshot(`
        "secret undefined
        args [ '--howdy', '--sup' ]
        "
      `)
    },
  )
})

test('lazy inherit supports passing args and rootDir and env vars', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({
        baseCommand: `node <rootDir>/build.js > out.txt`,
        coreBuildCommand: 'SECRET_VAR=shhh lazy inherit --foo --bar=<rootDir>',
        utilsBuildCommand: 'SECRET_VAR=hunter2 yarn run -T lazy inherit --howdy --sup',
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      await t.exec(['build'])
      expect(t.read('packages/core/out.txt').includes('--bar=' + t.config.dir)).toBe(true)
      expect(t.read('packages/utils/out.txt')).toMatchInlineSnapshot(`
        "secret hunter2
        args [ '--howdy', '--sup' ]
        "
      `)
    },
  )
})

test('calling lazy inherit in the core dir runs the full task graph', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({
        baseCommand: `node <rootDir>/build.js > out.txt`,
        coreBuildCommand: 'SECRET_VAR=shhh lazy inherit --foo --bar=<rootDir>',
        utilsBuildCommand: 'SECRET_VAR=hunter2 yarn run -T lazy inherit --howdy --sup',
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      await t.exec(['build'], { packageDir: 'packages/core' })
      expect(t.read('packages/core/out.txt').includes('--bar=' + t.config.dir)).toBe(true)
      expect(t.read('packages/utils/out.txt')).toMatchInlineSnapshot(`
          "secret hunter2
          args [ '--howdy', '--sup' ]
          "
        `)
    },
  )
})

test('calling lazy inherit in the utils dir runs only the utils build', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir({
        baseCommand: `node <rootDir>/build.js > out.txt`,
        coreBuildCommand: 'SECRET_VAR=shhh lazy inherit --foo --bar=<rootDir>',
        utilsBuildCommand: 'SECRET_VAR=hunter2 yarn run -T lazy inherit --howdy --sup',
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.exists('packages/utils/out.txt')).toBe(false)
      await t.exec(['build'], { packageDir: 'packages/utils' })
      expect(t.exists('packages/core/out.txt')).toBe(false)
      expect(t.read('packages/utils/out.txt')).toMatchInlineSnapshot(`
          "secret hunter2
          args [ '--howdy', '--sup' ]
          "
        `)
    },
  )
})

test('lazy inherit works works with top-level tasks', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: {
        'package.json': makePackageJson({
          scripts: {
            build: 'lazy inherit',
          },
        }),
        'lazy.config.js': `
          module.exports = {
            tasks: {
              build: {
                baseCommand: 'echo "running build"',
                execution: 'top-level',
              }
            }
          }
        `,
        workspace: {
          'package.json': makePackageJson({ name: 'child' }),
        },
      },
      workspaceGlobs: ['workspace'],
    },
    async (t) => {
      const { output } = await t.exec(['inherit'], { env: { npm_lifecycle_event: 'build' } })
      expect(output).toContain('running build')
    },
  )
})
