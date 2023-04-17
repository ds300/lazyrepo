import { LazyConfig } from '../../index.js'
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

test('it loads json files', async () => {
  await runIntegrationTest(
    {
      packageManager: 'npm',
      structure: makeRepo({
        configFileName: 'lazy.config.json',
        configFileContent: JSON.stringify({
          tasks: {
            build: {
              cache: 'none',
            },
          },
        } satisfies LazyConfig),
      }),
      workspaceGlobs: ['packages/*'],
    },
    async (t) => {
      const { status, output } = await t.exec(['build'])
      expect(t.exists('packages/core/.out.txt')).toBe(true)
      expect(status).toBe(0)
      expect(output.includes('cache disabled')).toBe(true)
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
      const { status, output } = await t.exec(['build'], { throwOnError: false })
      expect(status).toBe(1)
      expect(
        output.includes(`Failed reading config file at '${t.config.dir}/lazy.config.mjs'`),
      ).toBe(true)
    },
  )
})
