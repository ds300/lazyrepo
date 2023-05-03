import {
  Dir,
  makePackageJson,
  makePnpmWorkspaceYaml,
  runIntegrationTest,
} from './runIntegrationTests.js'

const makeRepo = ({
  packageJson = makePackageJson({
    name: '@test/core',
    scripts: {
      build: 'echo $RANDOM > .out.txt',
    },
  }),
} = {}): Dir => ({
  'lazy.config.js': 'export default {}',
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': packageJson,
    },
  },
})

test('throws error with exit 1 when package.json is invalid', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({ packageJson: makePackageJson({ version: undefined }) }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'], { expectError: true })
      expect(status).toBe(1)
      expect(output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        ∙ ERROR ∙ Failed reading package.json in '__ROOT_DIR__/packages/core'
        Required at "version"
        "
      `)
    },
  )
})

test('throws error with exit 1 when pnpm-workspace.yaml is invalid', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeRepo(),
      workspaceGlobs: ['packages/*'],
      workspaceConfig: { pnpmWorkspaceYaml: 'foo' },
    },
    async (t) => {
      const { status, output } = await t.exec(['build'], { expectError: true })
      expect(status).toBe(1)
      expect(output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        ∙ ERROR ∙ Failed reading pnpm-workspace.yaml in '__ROOT_DIR__'
        Expected object, received string
        "
      `)
    },
  )
})

test('loads package.json when it is valid', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo(),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(status).toBe(0)
      expect(output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  0/1 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('loads pnpm-workspace.yaml when it is valid', async () => {
  await runIntegrationTest(
    {
      packageManager: 'pnpm',
      structure: makeRepo(),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(status).toBe(0)
      expect(output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------
        Loaded config file: lazy.config.js

        build::packages/core finding files matching {yarn.lock,pnpm-lock.yaml,package-lock.json} took 1.00s
        build::packages/core finding files matching lazy.config.* took 1.00s
        build::packages/core finding files matching packages/core/**/* took 1.00s
        build::packages/core hashed 4/4 files in 1.00s
        build::packages/core cache miss, no previous manifest found
        build::packages/core RUN echo $RANDOM > .out.txt in packages/core
        build::packages/core input manifest: packages/core/.lazy/build/manifest.tsv
        build::packages/core ✔ done in 1.00s

             Tasks:  1 successful, 1 total
            Cached:  0/1 cached
              Time:  1.00s

        "
      `)
    },
  )
})

test('throws error with exit 1 when both package.json and pnpm-workspace.yaml workspaces exist in one dir', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: { ...makeRepo(), 'pnpm-workspace.yaml': makePnpmWorkspaceYaml(['packages/*']) },
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'], { expectError: true })
      expect(status).toBe(1)
      expect(output).toContain(
        "Both pnpm-workspace.yaml and package.json workspaces are defined in '__ROOT_DIR__'",
      )
    },
  )
})
