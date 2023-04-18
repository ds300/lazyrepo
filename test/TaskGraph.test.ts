import { join } from 'path'
import { TaskGraph } from '../src/TaskGraph.js'
import { Config } from '../src/config/config.js'
import { LazyConfig, PackageDetails, RepoDetails } from '../src/types.js'
import { topologicalSortPackages } from '../src/workspace.js'

const cwd = process.cwd()

function makePackage(name: string, localDeps: string[], scriptNames: string[]): PackageDetails {
  return {
    dir: join(cwd, `packages/${name}`),
    localDeps,
    name,
    scripts: Object.fromEntries(scriptNames.map((name) => [name, 'whatever'])),
  }
}

function makeRepoDetails(packages: PackageDetails[]): RepoDetails {
  const packagesByName = Object.fromEntries(packages.map((pkg) => [pkg.name, pkg]))
  return {
    packagesByDir: Object.fromEntries(packages.map((pkg) => [pkg.dir, pkg])),
    packagesByName,
    packagesInTopologicalOrder: topologicalSortPackages(packagesByName),
  }
}

function createRepoDetails(): RepoDetails {
  const packages: PackageDetails[] = [
    makePackage('core', ['utils'], ['prepack', 'pack', 'core-build']),
    makePackage('utils', [], ['prepack', 'pack', 'utils-build']),
  ]
  return makeRepoDetails(packages)
}

function makeConfig(repoDetails: RepoDetails, tasks: LazyConfig['tasks']): Config {
  return new Config({
    workspaceRoot: cwd,
    packageDirConfigs: {},
    repoDetails,
    rootConfig: {
      config: {
        tasks,
      },
      filePath: null,
    },
  })
}

function createConfig(tasks: LazyConfig['tasks']): Config {
  return makeConfig(createRepoDetails(), tasks)
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

test("utils' pack script should not depend on core's prepack script", () => {
  const graph = new TaskGraph({
    config: createConfig({
      pack: {
        runsAfter: { prepack: {} },
      },
      prepack: {},
    }),
    requestedTasks: [makeTask('pack', ['packages/utils'])],
  })

  expect(graph).toBeInstanceOf(TaskGraph)
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
    config: createConfig({
      'core-build': {
        runsAfter: { 'utils-build': {} },
      },
    }),
    requestedTasks: [makeTask('core-build', ['packages/core'])],
  })

  expect(graph).toBeInstanceOf(TaskGraph)
  expect(graph.sortedTaskKeys).toEqual(['utils-build::packages/utils', 'core-build::packages/core'])
})
