import assert from 'assert'
import micromatch from 'micromatch'
import { existsSync } from '../fs.js'
import { dirname, isAbsolute, join, sep } from '../path.js'
import { loadWorkspace } from './loadWorkspace.js'

/**
 * @param {string} dir
 * @returns {import('./project-types.js').PartialWorkspace | null}
 */
function findContainingPackage(dir) {
  assert(dir && isAbsolute(dir), 'findContainingPackage: dir must be absolute')
  let currentDir = dir
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(currentDir, 'package.json'))) {
      return loadWorkspace(currentDir)
    }
    if (currentDir === sep) {
      break
    }
    currentDir = dirname(currentDir)
  }
  return null
}

/**
 * @param {import('./project-types.js').PartialWorkspace} parent
 * @param {string} childDir
 */
function hasChildWorkspace(parent, childDir) {
  for (const globDef of parent.childWorkspaceGlobs) {
    const absoluteGlob = isAbsolute(globDef) ? globDef : join(parent.dir, globDef)
    if (micromatch([childDir], absoluteGlob).length > 0) {
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
  assert(dir && isAbsolute(dir), 'findRootWorkspace: dir must be absolute')
  let rootWorkspace = findContainingPackage(dir)
  if (!rootWorkspace) {
    return null
  }
  let childDir = rootWorkspace.dir
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const parent = findContainingPackage(dirname(childDir))
    if (!parent) {
      return rootWorkspace
    }
    if (hasChildWorkspace(parent, rootWorkspace.dir)) {
      rootWorkspace = parent
    } else if (parent.dir === sep) {
      return rootWorkspace
    } else {
      childDir = parent.dir
    }
  }
}
