import { glob } from '../glob/glob.js'
import { logger } from '../logger/logger.js'
import { Project } from '../project/Project.js'
import { rimraf } from '../utils/rimraf.js'

export function clean() {
  const project = Project.fromCwd(process.cwd())
  const cacheDirs = glob.sync(['**/.lazy'], {
    ignore: ['**/node_modules'],
    types: 'dirs',
    cwd: project.root.dir,
  })

  logger.log(`Cleaning ${cacheDirs.length} cache directories...`)
  cacheDirs.forEach(rimraf)
  return 0
}
