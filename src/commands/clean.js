import glob from 'fast-glob'
import { logger } from '../logger/logger.js'
import { rimraf } from '../rimraf.js'
import { workspaceRoot } from '../workspaceRoot.js'

export function clean() {
  const cacheDirs = glob.sync(['**/*/.lazy', '.lazy'], {
    ignore: ['**/node_modules/**'],
    absolute: true,
    onlyDirectories: true,
    cwd: workspaceRoot,
  })

  logger.log(`Cleaning ${cacheDirs.length} cache directories...`)
  cacheDirs.forEach(rimraf)
}
