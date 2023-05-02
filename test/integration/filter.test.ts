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
    cake: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/cake',
        scripts: {
          build: 'echo $RANDOM > .out.txt',
        },
      }),
    },
  },
} satisfies Dir

test('the --filter option works', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--filter', 'packages/core'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(t.exists('packages/utils/.out.txt')).toBe(false)
      expect(t.exists('packages/cake/.out.txt')).toBe(false)
    },
  )
})

test('the --filter option supports globs', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--filter', 'packages/c*'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(t.exists('packages/utils/.out.txt')).toBe(false)
      expect(t.exists('packages/cake/.out.txt')).toBe(true)
    },
  )
})

test('the --filter option can be specified multiple times', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const firstRun = await t.exec([
        'build',
        '--filter',
        'packages/cake',
        '--filter',
        'packages/utils',
      ])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.txt')).toBe(false)
      expect(t.exists('packages/utils/.out.txt')).toBe(true)
      expect(t.exists('packages/cake/.out.txt')).toBe(true)
    },
  )
})

test('the --filter option works with the = syntax', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--filter=packages/cake'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.txt')).toBe(false)
      expect(t.exists('packages/utils/.out.txt')).toBe(false)
      expect(t.exists('packages/cake/.out.txt')).toBe(true)
    },
  )
})

test('the --filter option works with the = syntax and globs', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const firstRun = await t.exec(['build', '--filter=packages/c*'])

      expect(firstRun.status).toBe(0)
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(t.exists('packages/utils/.out.txt')).toBe(false)
      expect(t.exists('packages/cake/.out.txt')).toBe(true)
    },
  )
})
