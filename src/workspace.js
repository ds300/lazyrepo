import assert from 'assert'
import glob from 'fast-glob'
import path from 'path'
import yaml from 'yaml'
import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'
import { existsSync, readFileSync } from './fs.js'
import { logger } from './logger/logger.js'

const packageJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
  workspaces: z.array(z.string()).optional(),
  scripts: z.record(z.string()).default({}),
  dependencies: z.record(z.string()).default({}),
  devDependencies: z.record(z.string()).default({}),
  peerDependencies: z.record(z.string()).default({}),
  optionalDependencies: z.record(z.string()).default({}),
})

const pnpmWorkspaceYamlSchema = z.object({
  packages: z.array(z.string()),
})

/** @typedef {z.infer<typeof packageJsonSchema>} PackageJson */
/** @typedef {z.infer<typeof pnpmWorkspaceYamlSchema>} PnpmWorkspaceYaml */

/**
 * @param {string} dir
 */
function readPackageJsonIfExists(dir) {
  const packageJsonPath = path.join(dir, 'package.json')
  let packageJsonString
  try {
    packageJsonString = readFileSync(packageJsonPath, 'utf8')
  } catch {
    return null
  }

  try {
    return packageJsonSchema.parse(JSON.parse(packageJsonString))
  } catch (err) {
    if (err instanceof z.ZodError) {
      const validationError = fromZodError(err, {
        issueSeparator: '\n',
        prefix: '',
        prefixSeparator: '',
      })
      throw new Error(validationError.message)
    }
    throw err
  }
}

/**
 * @param {string} dir
 */
function readPnpmWorkspaceYamlIfExists(dir) {
  const pnpmWorkspaceYamlPath = path.join(dir, 'pnpm-workspace.yaml')
  let pnpmWorkspaceYamlString
  try {
    pnpmWorkspaceYamlString = readFileSync(pnpmWorkspaceYamlPath, 'utf8')
  } catch {
    return null
  }

  try {
    return pnpmWorkspaceYamlSchema.parse(yaml.parse(pnpmWorkspaceYamlString))
  } catch (err) {
    if (err instanceof z.ZodError) {
      const validationError = fromZodError(err, {
        issueSeparator: '\n',
        prefix: '',
        prefixSeparator: '',
      })
      throw new Error(validationError.message)
    }
    throw err
  }
}

/**
 * @param {string} dir
 * @returns {Workspace | null}
 */
function findContainingPackage(dir) {
  let currentDir = dir
  while (currentDir !== path.dirname(currentDir)) {
    if (existsSync(path.join(currentDir, 'package.json'))) {
      return new Workspace(currentDir)
    }
    currentDir = path.dirname(currentDir)
  }
  return null
}

/** @param {Workspace} workspace */
function findDirectChildWorkspaces(workspace) {
  if (workspace.pnpmWorkspaceYaml && workspace.packageJson.workspaces) {
    throw new Error(
      `Both pnpm-workspace.yaml and package.json workspaces are defined in ${workspace.dir}`,
    )
  }

  const workspaceGlobs = workspace.pnpmWorkspaceYaml
    ? workspace.pnpmWorkspaceYaml.packages
    : workspace.packageJson.workspaces

  if (!workspaceGlobs || !workspaceGlobs.length) return []

  const directChildWorkspaces = []

  for (const workspaceGlob of workspaceGlobs) {
    for (const foundWorkspacePackageJsonPath of glob.sync(
      path.join(workspace.dir, workspaceGlob, 'package.json'),
    )) {
      const foundWorkspaceDir = path.dirname(foundWorkspacePackageJsonPath)
      const foundWorkspace = new Workspace(foundWorkspaceDir)

      if (foundWorkspace.pnpmWorkspaceYaml) {
        throw new Error(
          `pnpm-workspace.yaml is not allowed in child workspaces. Found in ${foundWorkspace.dir}`,
        )
      }

      directChildWorkspaces.push(foundWorkspace)
    }
  }

  return directChildWorkspaces
}

/**
 * A workspace represents a single directory that contains a package.json within a project.
 * Workspaces can contain other workspaces.
 */
export class Workspace {
  /**
   * @type {readonly string[] | null}
   * @private
   */
  _childWorkspaceNames = null

  /**
   * @type {readonly string[] | null}
   * @private
   */
  _localDependencies = null

  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir
    const packageJson = readPackageJsonIfExists(dir)
    if (!packageJson) {
      throw new Error(`Could not find package.json in ${dir}`)
    }
    this.packageJson = packageJson
    this.pnpmWorkspaceYaml = readPnpmWorkspaceYamlIfExists(dir)
  }

  get name() {
    return this.packageJson.name
  }

  get version() {
    return this.packageJson.version
  }

  get scripts() {
    return this.packageJson.scripts
  }

  get localDependencies() {
    assert(this._localDependencies !== null)
    return this._localDependencies
  }

  get childWorkspaceNames() {
    assert(this._childWorkspaceNames !== null)
    return this._childWorkspaceNames
  }

  /**
   * @param {readonly string[]} childWorkspaceNames
   */
  setChildWorkspaceNames(childWorkspaceNames) {
    assert(this._childWorkspaceNames === null)
    this._childWorkspaceNames = childWorkspaceNames
  }

  /**
   * @param {readonly string[]} localDependencies
   */
  setLocalDependencies(localDependencies) {
    assert(this._localDependencies === null)
    this._localDependencies = localDependencies
  }
}

export class Project {
  /**
   * @type {Workspace}
   * @readonly
   */
  root

  /**
   * @type {ReadonlyMap<string, Workspace>}
   * @readonly
   */
  workspacesByName

  /**
   * @type {ReadonlyMap<string, Workspace>}
   * @readonly
   */
  workspacesByDir

  /**
   * @type {ReadonlyArray<Workspace>}
   * @readonly
   */
  topologicallySortedWorkspaces

  /**
   *
   * @param {string} cwd
   */
  constructor(cwd) {
    /** @type {Map<string, Workspace>} */
    const workspacesByName = new Map()
    /** @type {Map<string, Workspace>} */
    const workspacesByDir = new Map()

    let workspace = findContainingPackage(cwd)
    if (!workspace) {
      throw new Error('Could not find containing package.json')
    }

    do {
      addChildWorkspaces(workspace, findDirectChildWorkspaces(workspace))
      workspacesByDir.set(workspace.dir, workspace)
      workspacesByName.set(workspace.packageJson.name, workspace)

      // if we have a pnpm-workspace.yaml, we don't need to look for a parent - pnpm workspace must exist at the root
      if (workspace.pnpmWorkspaceYaml) break
      // if we're at the top of the directory structure, we can't go any higher
      if (workspace.dir === path.dirname(workspace.dir)) break

      const parent = findContainingPackage(path.dirname(workspace.dir))
      // if we can't find a parent, we're at the top of the directory structure
      if (!parent) break

      const siblingWorkspaces = findDirectChildWorkspaces(parent)
      const currentWorkspaceDir = workspace.dir

      // does this parent contain the workspace we're currently looking at? if not, we're at the top of the project
      if (!siblingWorkspaces.some((sibling) => sibling.dir === currentWorkspaceDir)) {
        logger.warn(
          `Found parent package.json ${parent.packageJson.name} at ${parent.dir} but it does not contain the current workspace ${workspace.packageJson.name}`,
        )
        break
      }

      workspace = parent
      // eslint-disable-next-line no-constant-condition
    } while (true)

    this.root = workspace
    this.workspacesByName = workspacesByName
    this.workspacesByDir = workspacesByDir

    for (const workspace of this.workspacesByName.values()) {
      const allDependencies = {
        ...workspace.packageJson.dependencies,
        ...workspace.packageJson.devDependencies,
        ...workspace.packageJson.peerDependencies,
        ...workspace.packageJson.optionalDependencies,
      }
      /** @type {Set<string>} */
      const localDependencies = new Set()
      for (const dependencyName of Object.keys(allDependencies)) {
        const dependencyWorkspace = this.workspacesByName.get(dependencyName)
        if (!dependencyWorkspace) continue
        localDependencies.add(dependencyName)
      }
      workspace.setLocalDependencies([...localDependencies].sort())
    }

    this.topologicallySortedWorkspaces = topologicallySortWorkspaces(this.workspacesByName)

    /**
     * @param {Workspace} workspace
     * @param {Workspace[]} directChildWorkspaces
     */
    function addChildWorkspaces(workspace, directChildWorkspaces) {
      const childWorkspaceNames = new Set()
      for (const childWorkspace of directChildWorkspaces) {
        if (workspacesByDir.has(childWorkspace.dir)) continue

        const existingWorkspaceWithSameName = workspacesByName.get(childWorkspace.name)
        if (existingWorkspaceWithSameName) {
          throw new Error(
            `Duplicate workspace name ${childWorkspace.name} found in ${childWorkspace.dir} and ${existingWorkspaceWithSameName.dir}`,
          )
        }

        workspacesByName.set(childWorkspace.name, childWorkspace)
        workspacesByDir.set(childWorkspace.dir, childWorkspace)
        childWorkspaceNames.add(childWorkspace.name)

        addChildWorkspaces(childWorkspace, findDirectChildWorkspaces(childWorkspace))
      }
      workspace.setChildWorkspaceNames([...childWorkspaceNames].sort())
    }
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

  /**
   * @returns {'yarn' | 'pnpm' | 'npm' | null}
   */
  getPackageManager() {
    if (existsSync(path.join(this.root.dir, 'pnpm-lock.yaml'))) {
      return 'pnpm'
    } else if (existsSync(path.join(this.root.dir, 'yarn.lock'))) {
      return 'yarn'
    } else if (existsSync(path.join(this.root.dir, 'package-lock.json'))) {
      return 'npm'
    }
    return null
  }
}

/**
 * @param {ReadonlyMap<string, Workspace>} workspacesByName
 * @returns {Workspace[]}
 */
function topologicallySortWorkspaces(workspacesByName) {
  /**
   * @type {Workspace[]}
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

    const workspace = workspacesByName.get(packageName)
    if (!workspace) {
      throw new Error(`Could not find package ${packageName}. path: ${path.join(' -> ')}`)
    }
    for (const childWorkspaceName of workspace.childWorkspaceNames) {
      visit(childWorkspaceName, [...path, childWorkspaceName])
    }
    sorted.push(workspace)
  }

  for (const name of workspacesByName.keys()) {
    visit(name, [name])
  }

  return sorted
}
