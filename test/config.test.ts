import { join } from 'path'
import { LazyConfig } from '../index.js'
import { Config } from '../src/config/config.js'
import { Project } from '../src/project/Project.js'
import { Workspace } from '../src/project/project-types.js'

const cwd = process.cwd()

function makeWorkspace(name: string, localDeps: string[], scriptNames: string[]): Workspace {
  return {
    dir: join(cwd, `packages/${name}`),
    name,
    scripts: Object.fromEntries(scriptNames.map((name) => [name, 'whatever'])),
    allDependencyNames: localDeps,
    childWorkspaceGlobs: [],
    childWorkspaceNames: [],
    localDependencyWorkspaceNames: localDeps,
  }
}

function makeProject(workspaces: Workspace[]): Project {
  const workspacesByName: Record<string, Workspace> = Object.fromEntries(
    workspaces
      .concat([
        {
          dir: cwd,
          name: 'root',
          scripts: {},
          allDependencyNames: [],
          childWorkspaceGlobs: [],
          childWorkspaceNames: [],
          localDependencyWorkspaceNames: [],
        } satisfies Workspace,
      ])
      .map((pkg) => [pkg.name, pkg]),
  )
  return new Project(
    {
      rootWorkspaceName: 'root',
      workspacesByName,
    },
    'npm',
  )
}

function createProject(): Project {
  const workspaces: Workspace[] = [
    makeWorkspace('core', ['utils'], ['prepack', 'pack', 'core-build']),
    makeWorkspace('utils', [], ['prepack', 'pack', 'utils-build']),
  ]
  return makeProject(workspaces)
}

function makeConfig(project: Project, scripts: LazyConfig['scripts']): Config {
  return new Config({
    project,
    rootConfig: {
      config: {
        scripts,
      },
      filePath: null,
    },
    isVerbose: false,
  })
}

function createConfig(scripts: LazyConfig['scripts']): Config {
  return makeConfig(createProject(), scripts)
}

const getTaskConfig = (config: Config, reltativeDir: string, taskName: string) => {
  return config.getTaskConfig(
    config.project.getWorkspaceByDir(join(config.project.root.dir, reltativeDir)),
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
        { ...makeWorkspace('core', [], ['build']), name: '@foo/core' },
        { ...makeWorkspace('utils', [], ['build']), name: '@foo/utils' },
        { ...makeWorkspace('underwear', [], ['build']), name: '@foo/underwear' },
        { ...makeWorkspace('nothing', [], ['build']), name: '@bar/nothing' },
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
        { ...makeWorkspace('core', [], ['build']), name: '@foo/core' },
        { ...makeWorkspace('utils', [], ['build']), name: '@foo/utils' },
        { ...makeWorkspace('underwear', [], ['build']), name: '@foo/underwear' },
        { ...makeWorkspace('nothing', [], ['build']), name: '@bar/nothing' },
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
