import glob from 'fast-glob'
import { getWorkspaceRoot } from '../getWorkspaceRoot.js'
import { logger } from '../logger/logger.js'
import { naiveRimraf } from '../naiveRimraf.js'

export function clean() {
  const cacheDirs = glob.sync(['**/.lazy'], {
    ignore: ['**/node_modules'],
    absolute: true,
    onlyDirectories: true,
    cwd: getWorkspaceRoot(process.cwd()) ?? './',
  })

  logger.log(`Cleaning ${cacheDirs.length} cache directories...`)
  cacheDirs.forEach(naiveRimraf)
}
