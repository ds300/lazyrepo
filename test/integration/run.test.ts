import { Dir, makeConfigFile, runIntegrationTest } from './runIntegrationTests.js'

const makeDir = (): Dir => ({
  'lazy.config.js': makeConfigFile({
    scripts: {
      build: {
        execution: 'top-level',
        baseCommand: 'node index.js',
      },
    },
  }),
  'index.js': 'console.log(JSON.stringify(process.argv.slice(2)))',
})

test('run passes args after -- to the script', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeDir(),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      expect(t.exists('/out.txt')).toBe(false)
      const firstRun = await t.exec(['build', '--', 'foo', 'bar'])

      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::<rootDir> finding files took 1.00s
        build::<rootDir> hashed 5/5 files in 1.00s
        build::<rootDir> cache miss, no previous manifest found
        build::<rootDir> RUN node index.js foo bar in ./
        build::<rootDir> ["foo","bar"]
        build::<rootDir> input manifest: .lazy/build/manifest.tsv
        build::<rootDir> ✔ done in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  0/1 cached
              Time:  1.00s

        "
      `)
    },
  )
})
