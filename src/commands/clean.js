import glob from 'fast-glob'
import { logger } from '../logger/logger.js'
import { naiveRimraf } from '../naiveRimraf.js'
import { Project } from '../project/Project.js'

export async function clean() {
  const project = await Project.fromCwd(process.cwd())
  const cacheDirs = await glob(['**/.lazy'], {
    ignore: ['**/node_modules'],
    absolute: true,
    onlyDirectories: true,
    cwd: project.root.dir,
  })

  logger.log(`Cleaning ${cacheDirs.length} cache directories...`)
  await Promise.all(cacheDirs.map(naiveRimraf))
}
