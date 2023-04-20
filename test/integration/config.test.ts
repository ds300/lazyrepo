import { Dir, makePackageJson, runIntegrationTest } from './runIntegrationTests.js'

const makeRepo = ({
  configFileName = 'lazy.config.js',
  configFileContent = 'export default {}',
} = {}): Dir => ({
  [configFileName]: configFileContent,
  packages: {
    core: {
      'index.js': 'console.log("hello world")',
      'package.json': makePackageJson({
        name: '@test/core',
        scripts: {
          build: 'echo $RANDOM > .out.txt',
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
          build: 'echo $RANDOM > .out.txt',
        },
      }),
    },
  },
})

test('it loads .js config files', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({ configFileContent: `console.log('bananana'); export default {}` }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(status).toBe(0)
      expect(output.includes('bananana')).toBe(true)
    },
  )
})

test('it loads .mjs config files', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({
        configFileName: 'lazy.config.mjs',
        configFileContent: `console.log('funkydoodle'); export default {}`,
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(status).toBe(0)
      expect(output.includes('funkydoodle')).toBe(true)
    },
  )
})

test('it loads .cjs config files', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({
        configFileName: 'lazy.config.cjs',
        configFileContent: `console.log('isitfriday'); module.exports = {}`,
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(status).toBe(0)
      expect(output.includes('isitfriday')).toBe(true)
    },
  )
})

test('it loads .ts files', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({
        configFileName: 'lazy.config.ts',
        configFileContent: `type Banana = {color: 'yellow'}; console.log('iamthetypescript'); export default {}`,
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(status).toBe(0)
      expect(output.includes('iamthetypescript')).toBe(true)
    },
  )
})

test('it loads .ts files that import from external modules', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({
        configFileName: 'lazy.config.ts',
        configFileContent: `
        import {existsSync} from 'fs';
        type Banana = {color: 'yellow'};
        console.log('This file exists', existsSync(${JSON.stringify(__filename)}));
        export default {}
        `,
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(status).toBe(0)
      expect(output.includes('This file exists true')).toBe(true)
    },
  )
})

test('it loads .ts files that import from internal modules', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: {
        'otherFile.js': 'export const banana = "yellow"',
        ...makeRepo({
          configFileName: 'lazy.config.ts',
          configFileContent: `
        import {banana} from './otherFile.js';
        console.log('This color is', banana);
        export default {}
        `,
        }),
      },
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(status).toBe(0)
      expect(output.includes('This color is yellow')).toBe(true)
    },
  )
})

test('logs error with exit 1 when config is invalid', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({
        configFileName: 'lazy.config.mjs',
        configFileContent: `export default {foo: 'bar'}`,
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'], { expectError: true })
      expect(status).toBe(1)
      expect(output).toMatchInlineSnapshot(`
        "lazyrepo 0.0.0-test
        -------------------


        ∙ ERROR ∙ Failed reading config file at '__ROOT_DIR__/lazy.config.mjs'
        Unrecognized key(s) in object: 'foo'
        "
      `)
    },
  )
})

describe('in nested workspaces', () => {
  const structure: Dir = {
    'package.json': makePackageJson({
      name: 'root',
      scripts: {
        build: 'echo "ROOT_BUILD"',
      },
      workspaces: ['child'],
    }),
    'lazy.config.mjs': `
          console.log('ROOT_CONFIG')
          export default {}
        `,
    child: {
      'package.json': makePackageJson({
        name: 'child',
        workspaces: ['packages/*'],
        scripts: {
          build: 'echo "CHILD_BUILD"',
        },
      }),
      'lazy.config.mjs': `
            console.log('CHILD_CONFIG')
            export default {}
          `,
      packages: {
        a: {
          'package.json': makePackageJson({
            name: 'a',
            scripts: {
              build: 'echo "A_BUILD"',
            },
          }),
        },
        b: {
          'package.json': makePackageJson({
            name: 'b',
            scripts: {
              build: 'echo "B_BUILD"',
            },
          }),
        },
      },
    },
  }

  it('loads the root config when when from the root dir', async () => {
    await runIntegrationTest(
      {
        packageManager: 'npm',
        structure,
        workspaceGlobs: ['child'],
      },
      async (t) => {
        const { status, output } = await t.exec(['build'])
        expect(status).toBe(0)
        // it uses the root config
        expect(output.includes('ROOT_CONFIG')).toBe(true)
        // it does not use the child config
        expect(output.includes('CHILD_CONFIG')).toBe(false)
        // it does not run the root build script
        expect(output.includes('ROOT_BUILD')).toBe(false)
        // it does run the child build script
        expect(output.includes('CHILD_BUILD')).toBe(true)
        // it does run the child package build scripts
        expect(output.includes('A_BUILD')).toBe(true)
        expect(output.includes('B_BUILD')).toBe(true)
      },
    )
  })

  it('loads the root config when when from the child dir', async () => {
    await runIntegrationTest(
      {
        packageManager: 'npm',
        structure,
        workspaceGlobs: ['child'],
      },
      async (t) => {
        const { status, output } = await t.exec(['build'], { packageDir: 'child' })
        expect(status).toBe(0)
        // it uses the root config
        expect(output.includes('ROOT_CONFIG')).toBe(true)
        // it does not use the child config
        expect(output.includes('CHILD_CONFIG')).toBe(false)
        // it does not run the root build script
        expect(output.includes('ROOT_BUILD')).toBe(false)
        // it does run the child build script
        expect(output.includes('CHILD_BUILD')).toBe(true)
        // it does run the child package build scripts
        expect(output.includes('A_BUILD')).toBe(true)
        expect(output.includes('B_BUILD')).toBe(true)
      },
    )
  })

  it('loads the root config when run from a grandchild dir', async () => {
    await runIntegrationTest(
      {
        packageManager: 'npm',
        structure,
        workspaceGlobs: ['child'],
      },
      async (t) => {
        const { status, output } = await t.exec(['build'], { packageDir: 'child/packages/a' })
        expect(status).toBe(0)
        // it uses the root config
        expect(output.includes('ROOT_CONFIG')).toBe(true)
        // it does not use the child config
        expect(output.includes('CHILD_CONFIG')).toBe(false)
        // it does not run the root build script
        expect(output.includes('ROOT_BUILD')).toBe(false)
        // it does not run the child build script
        expect(output.includes('CHILD_BUILD')).toBe(false)
        // it does run the A package build scripts
        expect(output.includes('A_BUILD')).toBe(true)
        // it does not run the B package build scripts
        expect(output.includes('B_BUILD')).toBe(false)
      },
    )
  })
})
