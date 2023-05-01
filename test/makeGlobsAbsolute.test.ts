import { makeGlobsAbsolute } from '../src/manifest/getInputFiles.js'
import { createConfig } from './test-utils.js'

const cwd = process.cwd()

const cleanup = (string: string[]) => string.map((s) => s.replace(cwd, '__ROOT__'))

describe('makeGlobsAbsolute', () => {
  test('it works', () => {
    const config = createConfig({})
    const taskDir = config.project.getWorkspaceByName('core')!.dir
    expect(
      cleanup(
        makeGlobsAbsolute(
          ['src/**/*.js', '<rootDir>/src/**/*.js', '<allWorkspaceDirs>/src/**/*.js'],
          config,
          taskDir,
        ),
      ),
    ).toMatchInlineSnapshot(`
      [
        "__ROOT__/packages/core/src/**/*.js",
        "__ROOT__/src/**/*.js",
        "__ROOT__/{packages/core,packages/utils}/src/**/*.js",
      ]
    `)
  })
})
