import { makeConfigFile, runIntegrationTest } from './runIntegrationTests.js'

test('excludes take precedence', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: {
        'lazy.config.js': makeConfigFile({
          baseCacheConfig: {
            include: ['<rootDir>/scripts/**/*'],
            exclude: ['scripts/tsconfig.tsbuildinfo'],
          },
          tasks: {
            build: {
              cache: {
                inputs: ['scripts/build.js'],
              },
              execution: 'top-level',
              baseCommand: 'node scripts/build.js > .out.txt',
            },
          },
        }),
        scripts: {
          'build.js': 'console.log("hello")',
          'tsconfig.tsbuildinfo': 'blah',
        },
        packages: {},
      },
    },
    async (t) => {
      const firstRun = await t.exec(['build'])

      expect(firstRun.status).toBe(0)
      expect(firstRun.output).toMatchInlineSnapshot(`
        "lazyrepo @0.0.0-test
        --------------------
        Loaded config file: lazy.config.js

        build::<rootDir> Finding files matching scripts/**/* took 1.00s
        build::<rootDir> Finding files matching scripts/build.js took 1.00s
        build::<rootDir> Hashed 1/1 files in 1.00s
        build::<rootDir> cache miss, no previous manifest found
        build::<rootDir> RUN node scripts/build.js > .out.txt in 
        build::<rootDir> input manifest saved: .lazy/manifests/build
        build::<rootDir> ✔ done in 1.00s
        ✔ Done in 1.00s
        "
      `)

      expect(t.read('.out.txt')).toMatchInlineSnapshot(`
        "hello
        "
      `)

      expect(t.read('.lazy/manifests/build').includes('tsconfig.tsbuildinfo')).toBeFalsy()
      expect(t.read('.lazy/manifests/build').includes('build.js')).toBeTruthy()
    },
  )
})
