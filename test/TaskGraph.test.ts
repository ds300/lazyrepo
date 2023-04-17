import { join } from 'path'
import { TaskGraph } from '../src/TaskGraph.js'
import { Config } from '../src/config/config.js'
import { PackageDetails, RepoDetails } from '../src/types.js'

const cwd = process.cwd()

function createRepoDetails(): RepoDetails {
  const packages: PackageDetails[] = [
    {
      dir: join(cwd, 'packages/core'),
      localDeps: [],
      name: 'core',
      scripts: {
        prepack: 'whatever',
        pack: 'whatever',
      },
    },
    {
      dir: join(cwd, 'packages/utils'),
      localDeps: [],
      name: 'utils',
      scripts: {
        prepack: 'whatever',
        pack: 'whatever',
      },
    },
  ]
  return {
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
