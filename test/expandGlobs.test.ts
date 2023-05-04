import { expandGlobs } from '../src/manifest/getInputFiles.js'

const rootDir = '/__ROOT__'
const allWorkspaceDirs = [
  '/__ROOT__/packages/core',
  '/__ROOT__/packages/utils',
  '/__ROOT__/apps/web',
  '/__ROOT__/apps/mobile',
  '/__ROOT__/docs',
]

describe('expandGlobs', () => {
  test('it works', () => {
    expect(
      expandGlobs({
        allWorkspaceDirs,
        patterns: [
          'src/**/*.js',
          '<rootDir>/src/**/*.js',
          '<allWorkspaceDirs>/src/**/*.js',
          '../utils/src/**/*.js',
        ],

        rootDir,
        taskDir: '/__ROOT__/packages/core',
      }),
    ).toMatchInlineSnapshot(`
      [
        "/__ROOT__/packages/core/src/**/*.js",
        "/__ROOT__/src/**/*.js",
        "/__ROOT__/packages/core/src/**/*.js",
        "/__ROOT__/packages/utils/src/**/*.js",
        "/__ROOT__/apps/web/src/**/*.js",
        "/__ROOT__/apps/mobile/src/**/*.js",
        "/__ROOT__/docs/src/**/*.js",
        "/__ROOT__/packages/utils/src/**/*.js",
      ]
    `)

    expect(
      expandGlobs({
        allWorkspaceDirs,
        patterns: ['src/**/*.js', '<rootDir>/src/**/*.js', '<allWorkspaceDirs>/src/**/*.js'],
        rootDir,
        taskDir: '/__ROOT__/packages/utils',
      }),
    ).toMatchInlineSnapshot(`
      [
        "/__ROOT__/packages/utils/src/**/*.js",
        "/__ROOT__/src/**/*.js",
        "/__ROOT__/packages/core/src/**/*.js",
        "/__ROOT__/packages/utils/src/**/*.js",
        "/__ROOT__/apps/web/src/**/*.js",
        "/__ROOT__/apps/mobile/src/**/*.js",
        "/__ROOT__/docs/src/**/*.js",
      ]
    `)
  })
})
