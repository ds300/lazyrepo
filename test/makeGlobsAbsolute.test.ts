import { makeGlobsAbsolute } from '../src/manifest/getInputFiles.js'
import { makeConfig, makeProject, makeWorkspace } from './test-utils.js'

const cwd = process.cwd()

const cleanup = (string: string[]) => string.map((s) => s.replace(cwd, '__ROOT__'))

describe('makeGlobsAbsolute', () => {
  test('it works', () => {
    const config = makeConfig(
      makeProject([
        makeWorkspace('core', { dir: 'packages/core' }),
        makeWorkspace('utils', { dir: 'packages/utils' }),
        makeWorkspace('web', { dir: 'apps/web' }),
        makeWorkspace('mobile', { dir: 'apps/mobile' }),
        makeWorkspace('docs', { dir: 'docs' }),
      ]),
      {},
    )
    const taskDir = config.project.getWorkspaceByName('core')!.dir
    expect(
      cleanup(
        makeGlobsAbsolute(
          [
            'src/**/*.js',
            '<rootDir>/src/**/*.js',
            '<allWorkspaceDirs>/src/**/*.js',
            '../utils/src/**/*.js',
          ],

          config,
          taskDir,
        ),
      ),
    ).toMatchInlineSnapshot(`
      [
        "packages/core/src/**/*.js",
        "__ROOT__/src/**/*.js",
        "__ROOT__/{packages/core,packages/utils,apps/web,apps/mobile,docs}/src/**/*.js",
        "packages/utils/src/**/*.js",
      ]
    `)
  })

  test('it throws an error if the macro is not at the start of the string', () => {
    const config = makeConfig(
      makeProject([
        makeWorkspace('core', { dir: 'packages/core' }),
        makeWorkspace('utils', { dir: 'packages/utils' }),
      ]),
      {},
    )
    const taskDir = config.project.getWorkspaceByName('core')!.dir
    expect(() =>
      makeGlobsAbsolute(['src/**/*.js', 'src/<rootDir>/src/**/*.js'], config, taskDir),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Invalid glob: 'src/<rootDir>/src/**/*.js'. <rootDir> must be at the start of the string."`,
    )

    expect(() =>
      makeGlobsAbsolute(['src/**/*.js', 'src/<allWorkspaceDirs>/src/**/*.js'], config, taskDir),
    ).toThrowErrorMatchingInlineSnapshot(
      `"Invalid glob: 'src/<allWorkspaceDirs>/src/**/*.js'. <allWorkspaceDirs> must be at the start of the string."`,
    )
  })
})
