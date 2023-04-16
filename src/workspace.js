import glob from 'fast-glob'
import path from 'path'
import yaml from 'yaml'
import { existsSync, readFileSync } from './fs.js'
import { workspaceRoot } from './workspaceRoot.js'

/**
 *
 * @param {{ dir: string, allLocalPackageNames: string[] }} param
 * @returns {import('./types.js').PackageDetails | null}
 */
function getPackageDetails({ dir, allLocalPackageNames }) {
  const packageJsonPath = path.join(dir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return null
  }
  /** @type {import('./types.js').PackageJson} */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const packageJson = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.optionalDependencies,
  }
  return {
    name: packageJson.name,
    dir,
    version: packageJson.version,
    scripts: packageJson.scripts ?? {},
    localDeps: Object.keys(deps ?? {})
      .filter((dep) => allLocalPackageNames.includes(dep))
      // TODO: This sort is depended upon, test it!!!
      .sort(),
  }
}

/**
 * @type {import('./types.js').RepoDetails | null}
 */
let _repoDetails = null

/**
 *
 * @returns {string[]}
 */
function getWorkspaceGlobs() {
  try {
    const pnpmWorkspaceYamlPath = path.join(workspaceRoot, 'pnpm-workspace.yaml')
    if (existsSync(pnpmWorkspaceYamlPath)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const workspaceConfig = yaml.parse(readFileSync(pnpmWorkspaceYamlPath, 'utf8').toString())

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
      return workspaceConfig?.packages || []
    } else {
      /** @type {import('./types.js').PackageJson} */
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const packageJson = JSON.parse(readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'))
      return packageJson?.workspaces || []
    }
  } catch (e) {
    return []
  }
}

/**
 * @type {'yarn' | 'pnpm' | 'npm' | null}
 */
let _packageManager = null
/**
 * @returns {'yarn' | 'pnpm' | 'npm'}
 */
export function getPackageManager() {
  if (_packageManager) {
    return _packageManager
  }
  if (existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
    _packageManager = 'pnpm'
  } else if (existsSync(path.join(workspaceRoot, 'yarn.lock'))) {
    _packageManager = 'yarn'
  } else {
    _packageManager = 'npm'
  }
  return _packageManager
}

function getPackageJsonPaths() {
  const workspaceGlobs = getWorkspaceGlobs()
  const workspacePaths = workspaceGlobs.flatMap((pattern) => {
    return glob.sync(path.join(workspaceRoot, pattern, 'package.json'))
  })
  return workspacePaths
}

/**
 * @returns {import('./types.js').RepoDetails}
 */
export function getRepoDetails() {
  if (_repoDetails) {
    return _repoDetails
  }

  const packageJsonPaths = getPackageJsonPaths()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  const packageJsonObjects = packageJsonPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')))

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
  const allLocalPackageNames = packageJsonObjects.map((packageJson) => packageJson.name)

  /** @type {Object.<string, import('./types.js').PackageDetails>} */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const packages = Object.fromEntries(
    packageJsonPaths
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      .map((path, i) => [
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        packageJsonObjects[i].name,
        getPackageDetails({ dir: path.replace('/package.json', ''), allLocalPackageNames }),
      ])
      .filter(([, result]) => result !== null),
  )

  _repoDetails = {
    packagesByName: packages,
    packagesInTopologicalOrder: topologicalSortPackages(packages),
  }
  return _repoDetails
}

/**
 *
 * @param {Record<string, import('./types.js').PackageDetails>} packages
 * @returns {import('./types.js').PackageDetails[]}
 */

export function topologicalSortPackages(packages) {
  /**
   * @type {import('./types.js').PackageDetails[]}
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
    const packageDetails = packages[packageName]
    if (!packageDetails) {
      throw new Error(`Could not find package ${packageName}. path: ${path.join(' -> ')}`)
    }
    packageDetails.localDeps.forEach((dep) => visit(dep, [...path, dep]))
    sorted.push(packageDetails)
  }

  Object.keys(packages).forEach((packageName) => visit(packageName, [packageName]))

  return sorted
}
