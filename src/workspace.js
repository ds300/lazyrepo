import glob from 'fast-glob'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import yaml from 'yaml'
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
      const workspaceConfig = yaml.parse(readFileSync(pnpmWorkspaceYamlPath, 'utf8').toString())

      return workspaceConfig?.packages || []
    } else {
      const packageJson = JSON.parse(readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'))
      return packageJson?.workspaces || []
    }
  } catch (e) {
    return []
  }
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
  const packageJsonObjects = packageJsonPaths.map((path) => JSON.parse(readFileSync(path, 'utf8')))

  const allLocalPackageNames = packageJsonObjects.map((packageJson) => packageJson.name)

  const packages = Object.fromEntries(
    packageJsonPaths
      .map((path, i) => [
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
