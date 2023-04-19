import assert from 'assert'
import glob from 'fast-glob'
import path from 'path'
import { getPackageManager } from './getPackageManager.js'
import { loadWorkspace } from './loadWorkspace.js'

/** @param {import('./project-types.js').PartialWorkspace} workspace */
function findDirectChildWorkspaces(workspace) {
  if (workspace.childWorkspaceGlobs.length === 0) return []

  const directChildWorkspaces = []

  for (const workspaceGlob of workspace.childWorkspaceGlobs) {
    for (const foundWorkspacePackageJsonPath of glob.sync(
      path.join(workspace.dir, workspaceGlob, 'package.json'),
    )) {
      const foundWorkspaceDir = path.dirname(foundWorkspacePackageJsonPath)
      const foundWorkspace = loadWorkspace(foundWorkspaceDir)

      // do we care about this? seems like if they have nested pnpm-workspace.yaml files, they're doing something wrong anyway
      // and our stuff should work either way?
      // if (foundWorkspace.pnpmWorkspaceYaml) {
      //   throw new Error(
      //     `pnpm-workspace.yaml is not allowed in child workspaces. Found in ${foundWorkspace.dir}`,
      //   )
      // }

      directChildWorkspaces.push(foundWorkspace)
    }
  }

  return directChildWorkspaces
}

/**
 *
 * @param {import('./project-types.js').PartialWorkspace} workspace
 * @param {Map<string, import('./project-types.js').PartialWorkspace>} allWorkspacesByName
 * @returns {import('./project-types.js').PartialWorkspace}
 */
function hydrateChildWorkspaces(workspace, allWorkspacesByName) {
  const directChildWorkspaces = findDirectChildWorkspaces(workspace).map((w) =>
    hydrateChildWorkspaces(w, allWorkspacesByName),
  )

  /** @type {import('./project-types.js').PartialWorkspace} */
  const result = {
    ...workspace,
    childWorkspaceNames: directChildWorkspaces.map((w) => w.name),
  }

  if (allWorkspacesByName.has(workspace.name)) {
    const dirA = allWorkspacesByName.get(workspace.name)?.dir
    const dirB = workspace.dir
    if (dirA && dirA !== dirB) {
      throw new Error(
        `Found multiple workspaces with the name '${workspace.name}'. This is not allowed. Found in '${dirA}' and '${dirB}'`,
      )
    }
  } else {
    allWorkspacesByName.set(workspace.name, result)
  }

  return result
}

/**
 * @param {Map<string, import('./project-types.js').PartialWorkspace>} allWorkspacesByName
 */
function hydrateLocalDependencies(allWorkspacesByName) {
  for (const workspace of [...allWorkspacesByName.values()]) {
    const localDependencyWorkspaceNames = workspace.allDependencyNames.filter((depName) =>
      allWorkspacesByName.has(depName),
    )

    allWorkspacesByName.set(workspace.name, {
      ...workspace,
      localDependencyWorkspaceNames,
    })
  }
}

/**
 *
 * @param {import('./project-types.js').PartialWorkspace} workspace
 * @returns {workspace is import('./project-types.js').Workspace}
 */
function assertIsHydratedWorkspace(workspace) {
  if (!workspace.localDependencyWorkspaceNames) {
    throw new Error('Workspace is not hydrated')
  }

  if (!workspace.childWorkspaceNames) {
    throw new Error('Workspace is not hydrated')
  }

  return true
}

/**
 *
 * @param {import('./project-types.js').PartialWorkspace} rootWorkspace
 */
function hydrateWorkspaces(rootWorkspace) {
  /** @type {Map<string, import('./project-types.js').PartialWorkspace>} */
  const allWorkspacesByName = new Map()
  hydrateChildWorkspaces(rootWorkspace, allWorkspacesByName)
  hydrateLocalDependencies(allWorkspacesByName)
  /** @type {import('./project-types.js').Workspace[]} */
  const allWorkspaces = [...allWorkspacesByName.values()].filter(assertIsHydratedWorkspace)

  return {
    rootWorkspaceName: rootWorkspace.name,
    workspacesByName: Object.fromEntries(allWorkspaces.map((w) => [w.name, w])),
  }
}

export class Project {
  /**
   * @type {import('./project-types.js').Workspace}
   * @readonly
   */
  root

  /**
   * @type {ReadonlyMap<string, import('./project-types.js').Workspace>}
   * @readonly
   */
  workspacesByName

  /**
   * @type {ReadonlyMap<string, import('./project-types.js').Workspace>}
   * @readonly
   */
  workspacesByDir

  /**
   * @type {ReadonlyArray<import('./project-types.js').Workspace>}
   * @readonly
   */
  topologicallySortedWorkspaces

  /**
   * @type {import('./project-types.js').PackageManger}
   */
  packageManager

  /**
   * @param {string} cwd
   */
  static fromCwd(cwd) {
    const rootWorkspace = loadWorkspace(cwd)
    const config = hydrateWorkspaces(rootWorkspace)
    const packageManager = getPackageManager(rootWorkspace.dir)
    if (!packageManager) throw new Error('Could not find package manager lockfile')
    return new Project(config, packageManager)
  }

  /**
   * @param {ReturnType<typeof hydrateWorkspaces>} config
   * @param {"npm" | "yarn" | "pnpm"} packageManager
   */
  constructor(config, packageManager) {
    this.packageManager = packageManager
    this.root = config.workspacesByName[config.rootWorkspaceName]
    assert(this.root, 'Root workspace not found')

    this.workspacesByName = new Map(
      Object.entries(config.workspacesByName).filter(([name]) => name !== config.rootWorkspaceName),
    )
    this.workspacesByDir = new Map(
      Object.values(config.workspacesByName)
        .filter((w) => w.name !== config.rootWorkspaceName)
        .map((workspace) => [workspace.dir, workspace]),
    )

    this.topologicallySortedWorkspaces = topologicallySortWorkspaces(config.workspacesByName)
  }

  /**
   * @param {string} name
   */
  getWorkspaceByName(name) {
    const workspace = this.workspacesByName.get(name)
    if (!workspace) {
      throw new Error(`Could not find workspace named ${name}`)
    }
    return workspace
  }

  /**
   * @param {string} dir
   */
  getWorkspaceByDir(dir) {
    const workspace = this.workspacesByDir.get(dir)
    if (!workspace) {
      throw new Error(`Could not find workspace at ${dir}`)
    }
    return workspace
  }
}

/**
 * @param {Record<string, import('./project-types.js').Workspace>} workspacesByName
 * @returns {import('./project-types.js').Workspace[]}
 */
export function topologicallySortWorkspaces(workspacesByName) {
  /**
   * @type {import('./project-types.js').Workspace[]}
   */
  const sorted = []
  /**
   * @type {Set<string>}
   */
  const visited = new Set()

  /**
   *
   * @param {string} packageName
   * @param {string[]} path
   * @returns
   */
  function visit(packageName, path) {
    if (visited.has(packageName)) {
      return
    }
    visited.add(packageName)

    const workspace = workspacesByName[packageName]
    if (!workspace) {
      throw new Error(`Could not find package ${packageName}. path: ${path.join(' -> ')}`)
    }
    for (const childWorkspaceName of workspace.childWorkspaceNames) {
      visit(childWorkspaceName, [...path, childWorkspaceName])
    }
    sorted.push(workspace)
  }

  for (const name of Object.keys(workspacesByName)) {
    visit(name, [name])
  }

  return sorted
}
