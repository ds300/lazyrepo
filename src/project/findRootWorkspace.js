import micromatch from 'micromatch'
import { dirname, isAbsolute, join } from 'path'
import { existsSync } from '../fs.js'
import { loadWorkspace } from './loadWorkspace.js'

/**
 * @param {string} dir
 * @returns {import('./project-types.js').PartialWorkspace | null}
 */
function findContainingPackage(dir) {
  let currentDir = dir
  while (currentDir !== dirname(currentDir)) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return loadWorkspace(currentDir)
    }
    currentDir = dirname(currentDir)
  }
  return null
}

/**
 * @param {import('./project-types.js').PartialWorkspace} parent
 * @param {import('./project-types.js').PartialWorkspace} child
 */
function hasChildWorkspace(parent, child) {
  for (const globDef of parent.childWorkspaceGlobs) {
    const absoluteGlob = isAbsolute(globDef) ? globDef : join(parent.dir, globDef)
    if (micromatch([child.dir], absoluteGlob).length > 0) {
      return true
    }
  }
  return false
}

/**
 * @param {string} dir
 * @returns
 */
export function findRootWorkspace(dir) {
  let workspace = findContainingPackage(dir)
  if (!workspace) {
    return null
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const parent = findContainingPackage(dirname(workspace.dir))
    if (!parent || !hasChildWorkspace(parent, workspace)) {
      return workspace
    }
    workspace = parent
  }
}
