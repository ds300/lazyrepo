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

test(`help runs`, async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      workspaceGlobs: ['packages/*'],
      structure: simpleDir,
    },
    async (t) => {
      const { output, status } = await t.exec([':help'])

      expect(output).toMatchInlineSnapshot(`
        "
        ::  lazyrepo  ::

        USAGE

        Running tasks:

          lazy <script-name> [...args]

        Creating a blank config file:

          lazy init <task> [...args]

        Showing this help message

          lazy help

        "
      `)
      expect(status).toBe(0)
    },
  )
})
