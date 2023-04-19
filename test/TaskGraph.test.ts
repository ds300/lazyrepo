import { join } from 'path'
import stripAnsi from 'strip-ansi'
import { TaskGraph } from '../src/TaskGraph.js'
import { Config } from '../src/config/config.js'
import { Project } from '../src/project/Project.js'
import { Workspace } from '../src/project/project-types.js'
import { LazyConfig } from '../src/types.js'

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

function makeConfig(project: Project, tasks: LazyConfig['tasks']): Config {
  return new Config({
    project,
    rootConfig: {
      config: {
        tasks,
      },
      filePath: null,
    },
  })
}

function createConfig(tasks: LazyConfig['tasks']): Config {
  return makeConfig(createProject(), tasks)
}

function makeTask(
  taskName: string,
  filterPaths: string[] = [],
  extraArgs: string[] = [],
  force = false,
): { taskName: string; filterPaths: string[]; extraArgs: string[]; force: boolean } {
  return {
    taskName,
    filterPaths,
    extraArgs,
    force,
  }
}

test("with self-only utils' pack script should not depend on core's prepack script", () => {
  const graph = new TaskGraph({
    config: createConfig({
      pack: {
        runsAfter: { prepack: { in: 'self-only' } },
      },
      prepack: {},
    }),
    requestedTasks: [makeTask('pack', ['packages/utils'])],
  })

  expect(graph.sortedTaskKeys).toEqual(['prepack::packages/utils', 'pack::packages/utils'])
})

test("with self-and-dependencies utils' pack script should not depend on core's prepack script", () => {
  const graph = new TaskGraph({
    config: createConfig({
      pack: {
        runsAfter: { prepack: { in: 'self-and-dependencies' } },
      },
      prepack: {},
    }),
    requestedTasks: [makeTask('pack', ['packages/utils'])],
  })

  expect(graph.sortedTaskKeys).toEqual(['prepack::packages/utils', 'pack::packages/utils'])
})

test("core's pack script should depend on everything", () => {
  const graph = new TaskGraph({
    config: createConfig({
      pack: {
        runsAfter: { prepack: {} },
      },
      prepack: {},
    }),
    requestedTasks: [makeTask('pack', ['packages/core'])],
  })

  expect(graph.sortedTaskKeys).toEqual([
    'prepack::packages/utils',
    'prepack::packages/core',
    'pack::packages/utils',
    'pack::packages/core',
  ])
})

test('core-build should depend on utils-build', () => {
  const graph = new TaskGraph({
    config: createConfig({
      'core-build': {
        runsAfter: { 'utils-build': {} },
      },
    }),
    requestedTasks: [makeTask('core-build', ['packages/core'])],
  })

  expect(graph.sortedTaskKeys).toEqual(['utils-build::packages/utils', 'core-build::packages/core'])
})

test('when circular dependencies are detected an error is thrown', () => {
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  let stderr = ''
  const stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += chunk
    return true
  })
  try {
    new TaskGraph({
      config: createConfig({
        'core-build': {
          runsAfter: { 'core-build': {} },
        },
      }),
      requestedTasks: [makeTask('core-build', ['packages/core'])],
    })

    expect(exit).toHaveBeenCalledWith(1)
    expect(stripAnsi(stderr)).toMatchInlineSnapshot(`
      "

      ∙ ERROR ∙ Circular dependency detected: 
      core-build::packages/core
       -> core-build::packages/core
      "
    `)

    stderr = ''

    new TaskGraph({
      config: createConfig({
        'core-build': {
          runsAfter: { 'utils-build': {} },
        },
        'utils-build': {
          runsAfter: { 'core-build': {} },
        },
      }),
      requestedTasks: [makeTask('core-build', ['packages/core'])],
    })
    expect(stripAnsi(stderr)).toMatchInlineSnapshot(`
      "

      ∙ ERROR ∙ Circular dependency detected: 
      core-build::packages/core
       -> utils-build::packages/utils
       -> core-build::packages/core
      "
    `)
  } finally {
    stderrWrite.mockRestore()
    exit.mockRestore()
  }
})

describe('running "pack" on its own in a package with dependencies', () => {
  const graph = (taskConfig: LazyConfig['tasks']) => {
    return new TaskGraph({
      config: makeConfig(
        makeProject([
          makeWorkspace('app', ['utils', 'styles'], ['prepack', 'pack', 'core-build']),
          makeWorkspace('styles', ['utils'], ['prepack', 'pack', 'styles-build']),
          makeWorkspace('utils', [], ['prepack', 'pack', 'utils-build']),
        ]),
        taskConfig,
      ),
      requestedTasks: [makeTask('pack', ['packages/app'])],
    })
  }

  it('by default will pack its dependencies too', () => {
    expect(graph({}).sortedTaskKeys).toMatchInlineSnapshot(`
      [
        "pack::packages/utils",
        "pack::packages/styles",
        "pack::packages/app",
      ]
    `)
  })

  it('should not pack its dependencies if the pack script is set to "independent"', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "pack::packages/app",
      ]
    `)
  })

  it('will run the command on its own in <rootDir> if set to top level without dependencies', () => {
    expect(
      graph({
        pack: {
          execution: 'top-level',
          baseCommand: 'whatever',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "pack::<rootDir>",
      ]
    `)
  })

  it('will run with all prepack scripts if runsAfter includes prepack', () => {
    expect(
      graph({
        pack: {
          runsAfter: { prepack: {} },
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/utils",
        "prepack::packages/styles",
        "prepack::packages/app",
        "pack::packages/utils",
        "pack::packages/styles",
        "pack::packages/app",
      ]
    `)
  })
  it('will run with all prepack scripts but not upstream pack scripts if runsAfter includes prepack and pack is independent', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: {} },
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/utils",
        "prepack::packages/styles",
        "prepack::packages/app",
        "pack::packages/app",
      ]
    `)
  })
  it('will run with only its own prepack script if pack is independent and runsAfter.prepack.in === "self-only" and prepack is independent', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: { in: 'self-only' } },
        },
        prepack: {
          execution: 'independent',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/app",
        "pack::packages/app",
      ]
    `)
  })

  it('will run with its own prepack script and its dependencies\' prepack scripts if pack is independent and runsAfter.prepack.in === "self-and-dependencies" and prepack is independent', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: { in: 'self-and-dependencies' } },
        },
        prepack: {
          execution: 'independent',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/app",
        "prepack::packages/utils",
        "prepack::packages/styles",
        "pack::packages/app",
      ]
    `)
  })

  it('will run with all prepack scripts if pack is independent and runsAfter.prepack.in === "all-packages"', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: { in: 'all-packages' } },
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/utils",
        "prepack::packages/styles",
        "prepack::packages/app",
        "pack::packages/app",
      ]
    `)
  })
})

describe('running "pack" on its own in a package with both dependents and dependencies', () => {
  const graph = (taskConfig: LazyConfig['tasks']) => {
    return new TaskGraph({
      config: makeConfig(
        makeProject([
          makeWorkspace('app', ['utils', 'styles'], ['prepack', 'pack', 'core-build']),
          makeWorkspace('styles', ['utils'], ['prepack', 'pack', 'styles-build']),
          makeWorkspace('utils', [], ['prepack', 'pack', 'utils-build']),
        ]),
        taskConfig,
      ),
      requestedTasks: [makeTask('pack', ['packages/styles'])],
    })
  }

  it('by default will pack its dependencies too', () => {
    expect(graph({}).sortedTaskKeys).toMatchInlineSnapshot(`
      [
        "pack::packages/utils",
        "pack::packages/styles",
      ]
    `)
  })

  it('should not pack its dependencies if the pack script is set to "independent"', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "pack::packages/styles",
      ]
    `)
  })

  it('will run the command on its own in <rootDir> if set to top level without dependencies', () => {
    expect(
      graph({
        pack: {
          execution: 'top-level',
          baseCommand: 'whatever',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "pack::<rootDir>",
      ]
    `)
  })

  it('will run with all upstream prepack scripts if runsAfter includes prepack', () => {
    expect(
      graph({
        pack: {
          runsAfter: { prepack: {} },
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/utils",
        "prepack::packages/styles",
        "prepack::packages/app",
        "pack::packages/utils",
        "pack::packages/styles",
      ]
    `)
  })
  it('will run with all prepack scripts but not upstream pack scripts if runsAfter includes prepack and pack is independent', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: {} },
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/utils",
        "prepack::packages/styles",
        "prepack::packages/app",
        "pack::packages/styles",
      ]
    `)
  })

  it('will run with only its own prepack script if pack is independent and runsAfter.prepack.in === "self-only" and prepack is independent', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: { in: 'self-only' } },
        },
        prepack: {
          execution: 'independent',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/styles",
        "pack::packages/styles",
      ]
    `)
  })

  it('will run with its own prepack script and its dependencies\' prepack scripts if pack is independent and runsAfter.prepack.in === "self-and-dependencies" and prepack is independent', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: { in: 'self-and-dependencies' } },
        },
        prepack: {
          execution: 'independent',
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/styles",
        "prepack::packages/utils",
        "pack::packages/styles",
      ]
    `)
  })

  it('will run with all prepack scripts if pack is independent and runsAfter.prepack.in === "all-packages"', () => {
    expect(
      graph({
        pack: {
          execution: 'independent',
          runsAfter: { prepack: { in: 'all-packages' } },
        },
      }).sortedTaskKeys,
    ).toMatchInlineSnapshot(`
      [
        "prepack::packages/utils",
        "prepack::packages/styles",
        "prepack::packages/app",
        "pack::packages/styles",
      ]
    `)
  })
})
