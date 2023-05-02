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
        "lazyrepo 0.0.0-test
        -------------------
        lazy

        Usage:
          $ lazy <script>

        Commands:
          <script>      run the script in all packages that support it
          run <script>  run the script in all packages that support it
          init          create config file
          clean         delete all local cache data
          inherit       (use in package.json "scripts" only) Runs the command specified in the lazy config file for the script name.

        For more info, run any command with the \`--help\` flag:
          $ lazy --help
          $ lazy run --help
          $ lazy init --help
          $ lazy clean --help
          $ lazy inherit --help

        Options:
          --filter <path-glob>  [string] only run the script in packages that match the given path glob 
          --force               [boolean] ignore the cache (default: false)
          --verbose             [boolean] verbose log output (default: false)
          -h, --help            Display this message 
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
      const { output, status } = await t.exec([], { expectError: true })

      expect(output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Missing required args for command \`<script>\`

        lazy

        Usage:
          $ lazy <script>

        Commands:
          <script>      run the script in all packages that support it
          run <script>  run the script in all packages that support it
          init          create config file
          clean         delete all local cache data
          inherit       (use in package.json "scripts" only) Runs the command specified in the lazy config file for the script name.

        For more info, run any command with the \`--help\` flag:
          $ lazy --help
          $ lazy run --help
          $ lazy init --help
          $ lazy clean --help
          $ lazy inherit --help

        Options:
          --filter <path-glob>  [string] only run the script in packages that match the given path glob 
          --force               [boolean] ignore the cache (default: false)
          --verbose             [boolean] verbose log output (default: false)
          -h, --help            Display this message 
        "
      `)
      expect(status).toBe(1)
    },
  )
})
