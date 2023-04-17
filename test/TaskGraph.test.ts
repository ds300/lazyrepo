import { join } from 'path'
import { TaskGraph } from '../src/TaskGraph.js'
import { Config } from '../src/config/config.js'
import { PackageDetails, RepoDetails } from '../src/types.js'

const cwd = process.cwd()

function createRepoDetails(): RepoDetails {
  const packages: PackageDetails[] = [
    {
      dir: join(cwd, 'packages/core'),
      localDeps: ['utils'],
      name: 'core',
      scripts: {
        prepack: 'whatever',
        pack: 'whatever',
        'core-build': 'whatever',
      },
    },
    {
      dir: join(cwd, 'packages/utils'),
      localDeps: [],
      name: 'utils',
      scripts: {
        prepack: 'whatever',
        pack: 'whatever',
        'utils-build': 'whatever',
      },
    },
  ]
  return {
    packagesByDir: { [packages[0].dir]: packages[0], [packages[1].dir]: packages[1] },
    packagesByName: { core: packages[0], utils: packages[1] },
    packagesInTopologicalOrder: [packages[1], packages[0]],
  }
}

test("utils' pack script should not depend on core's prepack script", () => {
  const graph = new TaskGraph({
    config: new Config({
      workspaceRoot: cwd,
      packageDirConfigs: {},
      repoDetails: createRepoDetails(),
      rootConfig: {
        config: {
          tasks: {
            pack: {
              runsAfter: { prepack: {} },
            },
            prepack: {},
          },
        },
        filePath: null,
      },
    }),
    requestedTasks: [
      {
        extraArgs: [],
        force: false,
        taskName: 'pack',
        filterPaths: ['packages/utils'],
      },
    ],
  })

  expect(graph).toBeInstanceOf(TaskGraph)
  expect(graph.sortedTaskKeys).toEqual(['prepack::packages/utils', 'pack::packages/utils'])
})

test("core's pack script should depend on everything", () => {
  const graph = new TaskGraph({
    config: new Config({
      workspaceRoot: cwd,
      packageDirConfigs: {},
      repoDetails: createRepoDetails(),
      rootConfig: {
        config: {
          tasks: {
            pack: {
              runsAfter: { prepack: {} },
            },
            prepack: {},
          },
        },
        filePath: null,
      },
    }),
    requestedTasks: [
      {
        extraArgs: [],
        force: false,
        taskName: 'pack',
        filterPaths: ['packages/core'],
      },
    ],
  })

  expect(graph).toBeInstanceOf(TaskGraph)
  expect(graph.sortedTaskKeys).toEqual([
    'prepack::packages/utils',
    'prepack::packages/core',
    'pack::packages/utils',
    'pack::packages/core',
  ])
})

test('core-build should depend on utils-build', () => {
  const graph = new TaskGraph({
    config: new Config({
      workspaceRoot: cwd,
      packageDirConfigs: {},
      repoDetails: createRepoDetails(),
      rootConfig: {
        config: {
          tasks: {
            'core-build': {
              runsAfter: { 'utils-build': {} },
            },
          },
        },
        filePath: null,
      },
    }),
    requestedTasks: [
      {
        extraArgs: [],
        force: false,
        taskName: 'core-build',
        filterPaths: ['packages/core'],
      },
    ],
  })

  expect(graph).toBeInstanceOf(TaskGraph)
  expect(graph.sortedTaskKeys).toEqual(['utils-build::packages/utils', 'core-build::packages/core'])
})
