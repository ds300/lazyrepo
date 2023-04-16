import path from 'path'
import { existsSync, readFileSync } from './fs.js'

/**
 * @param {string} dir
 * @returns
 */
function isWorkspaceRoot(dir) {
  return !!(
    existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
    (existsSync(path.join(dir, 'package.json')) &&
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).workspaces)
  )
}

/**
 * @param {string} workingDir
 */
export function getWorkspaceRoot(workingDir) {
  let dir = workingDir

  while (!isWorkspaceRoot(dir)) {
    const parentDir = path.dirname(dir)
    if (parentDir === dir) {
      const packageJson = findUp('package.json', workingDir)
      if (!packageJson) {
        return null
      }
      return path.dirname(packageJson)
    }
    dir = parentDir
  }

  return dir
}

/**
 * @param {string} filename
 * @param {string} cwd
 */
function findUp(filename, cwd) {
  let file = path.join(cwd, filename)
  while (path.dirname(file) !== path.sep && !existsSync(file)) {
    file = path.join(path.dirname(path.dirname(file)), filename)
  }
  if (!existsSync(file)) {
    return null
  }
  return file
}
