import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { logger } from './log.js'

/**
 * @param {string} dir
 * @returns
 */
function isWorkspaceRoot(dir) {
  return (
    existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
    (existsSync(path.join(dir, 'package.json')) &&
      JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).workspaces)
  )
}

let dir = process.cwd()

while (!isWorkspaceRoot(dir)) {
  const parentDir = path.dirname(dir)
  if (parentDir === dir) {
    logger.fail('Could not find workspace root. Are you in a yarn/npm/pnpm workspace?')
  }
  dir = parentDir
}

export const workspaceRoot = dir
