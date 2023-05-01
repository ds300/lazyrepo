import { join } from 'path'
import { Config } from '../src/config/config.js'
import { createConfig, makeConfig, makeProject, makeScripts, makeWorkspace } from './test-utils.js'

const getTaskConfig = (config: Config, relativeDir: string, taskName: string) => {
  return config.getTaskConfig(
    config.project.getWorkspaceByDir(join(config.project.root.dir, relativeDir)),
    taskName,
  )
}

describe('script overrides', () => {
  it('allow overriding the baseCommand', () => {
    const config = createConfig({
      build: {
        cache: 'none',
        baseCommand: 'echo root_build',
        workspaceOverrides: {
          'packages/core': {
            baseCommand: 'echo core_build',
          },
        },
      },
    })
    expect(getTaskConfig(config, 'packages/utils', 'build').baseCommand).toEqual('echo root_build')
    expect(getTaskConfig(config, 'packages/core', 'build').baseCommand).toEqual('echo core_build')

    expect(getTaskConfig(config, 'packages/utils', 'build').cache).toEqual('none')
    expect(getTaskConfig(config, 'packages/core', 'build').cache).toEqual('none')
  })

  it('uses undefined values to reset to default', () => {
    const config = createConfig({
      build: {
        cache: 'none',
        workspaceOverrides: {
          'packages/utils': {
            cache: undefined,
          },
        },
      },
    })
    expect(getTaskConfig(config, 'packages/core', 'build').cache).toEqual('none')
    expect(getTaskConfig(config, 'packages/utils', 'build').cache).toMatchInlineSnapshot(`
      {
        "envInputs": [],
        "inheritsInputFromDependencies": true,
        "inputs": {
          "exclude": [],
          "include": [
            "**/*",
          ],
        },
        "outputs": {
          "exclude": [],
          "include": [],
        },
        "usesOutputFromDependencies": true,
      }
    `)
  })

  it('allows overriding by package name rather than dir', () => {
    const config = makeConfig(
      makeProject([
        makeWorkspace('@foo/core', { scripts: makeScripts(['build']) }),
        makeWorkspace('@foo/utils', { scripts: makeScripts(['build']) }),
        makeWorkspace('@foo/underwear', { scripts: makeScripts(['build']) }),
        makeWorkspace('@bar/nothing', { scripts: makeScripts(['build']) }),
      ]),
      {
        build: {
          baseCommand: 'echo root_build',
          workspaceOverrides: {
            '@foo/core': {
              baseCommand: 'echo core_build',
            },
            '@foo/u*': {
              baseCommand: 'echo u_any_build',
            },
            '@bar/*': {
              baseCommand: 'echo bar_build',
            },
          },
        },
      },
    )

    expect(getTaskConfig(config, 'packages/core', 'build').baseCommand).toEqual('echo core_build')
    expect(getTaskConfig(config, 'packages/utils', 'build').baseCommand).toEqual('echo u_any_build')
    expect(getTaskConfig(config, 'packages/underwear', 'build').baseCommand).toEqual(
      'echo u_any_build',
    )
    expect(getTaskConfig(config, 'packages/nothing', 'build').baseCommand).toEqual('echo bar_build')
  })

  it('complains if a workspace matches more than one override', () => {
    const config = makeConfig(
      makeProject([
        makeWorkspace('@foo/core', { scripts: makeScripts(['build']) }),
        makeWorkspace('@foo/utils', { scripts: makeScripts(['build']) }),
        makeWorkspace('@foo/underwear', { scripts: makeScripts(['build']) }),
        makeWorkspace('@bar/nothing', { scripts: makeScripts(['build']) }),
      ]),
      {
        build: {
          baseCommand: 'echo root_build',
          workspaceOverrides: {
            '@foo/core': {
              baseCommand: 'echo core_build',
            },
            'packages/core': {
              baseCommand: 'echo core_p_build',
            },
            '@foo/u*': {
              baseCommand: 'echo u_any_build',
            },
            '@foo/utils': {
              baseCommand: 'echo u_any_build',
            },
            'packages/n*': {
              baseCommand: 'echo n_any_build',
            },
            'packages/nothing': {
              baseCommand: 'echo nothing_build',
            },
          },
        },
      },
    )

    expect(() => {
      getTaskConfig(config, 'packages/core', 'build').baseCommand
    }).toThrowErrorMatchingInlineSnapshot(`
      "Workspace 'packages/core' matched multiple overrides for script "build": ['@foo/core', 'packages/core']
      Please make sure that the workspace only matches one override."
    `)

    expect(() => {
      getTaskConfig(config, 'packages/utils', 'build').baseCommand
    }).toThrowErrorMatchingInlineSnapshot(`
      "Workspace 'packages/utils' matched multiple overrides for script "build": ['@foo/u*', '@foo/utils']
      Please make sure that the workspace only matches one override."
    `)

    expect(() => {
      getTaskConfig(config, 'packages/nothing', 'build').baseCommand
    }).toThrowErrorMatchingInlineSnapshot(`
      "Workspace 'packages/nothing' matched multiple overrides for script "build": ['packages/n*', 'packages/nothing']
      Please make sure that the workspace only matches one override."
    `)
  })
})
