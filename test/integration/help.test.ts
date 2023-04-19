import { Dir, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const simpleDir: Dir = {
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/core',
        dependencies: {
          '@test/utils': '*',
        },
      }),
    },
    utils: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/utils',
      }),
    },
  },
}

test(`help prints with exit 0 when you pass --help`, async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const { output, status } = await t.exec(['--help'])

      expect(output).toMatchInlineSnapshot(`
        "lazyrepo @0.0.0-test
        --------------------
        lazy

        Usage:
          $ lazy <task>

        Commands:
          <task>      run task in all packages
          run <task>  run task in all packages
          init        create config file
          clean       delete all local cache data
          inherit     run command from configuration file specified by script name

        For more info, run any command with the \`--help\` flag:
          $ lazy --help
          $ lazy run --help
          $ lazy init --help
          $ lazy clean --help
          $ lazy inherit --help

        Options:
          --filter <paths>  [string] run task in packages specified by paths 
          --force           [boolean] ignore existing cached artifacts (default: false)
          -h, --help        Display this message 
        "
      `)
      expect(status).toBe(0)
    },
  )
})

test(`help prints with exit 1 if you pass nothing`, async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const { output, status } = await t.exec([], { throwOnError: false })

      expect(output).toMatchInlineSnapshot(`
        "lazyrepo @0.0.0-test
        --------------------
        Missing required args for command \`<task>\`

        lazy

        Usage:
          $ lazy <task>

        Commands:
          <task>      run task in all packages
          run <task>  run task in all packages
          init        create config file
          clean       delete all local cache data
          inherit     run command from configuration file specified by script name

        For more info, run any command with the \`--help\` flag:
          $ lazy --help
          $ lazy run --help
          $ lazy init --help
          $ lazy clean --help
          $ lazy inherit --help

        Options:
          --filter <paths>  [string] run task in packages specified by paths 
          --force           [boolean] ignore existing cached artifacts (default: false)
          -h, --help        Display this message 
        "
      `)
      expect(status).toBe(1)
    },
  )
})
