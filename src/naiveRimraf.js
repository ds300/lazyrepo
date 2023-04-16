import { join } from 'path'
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from './fs.js'

/**
 * @param {string} path
 */
export const naiveRimraf = (path) => {
  if (!existsSync(path)) return
  const isDir = statSync(path).isDirectory()
  if (isDir) {
    for (const file of readdirSync(path)) {
      const fullPath = join(path, file)
      naiveRimraf(fullPath)
    }
    rmdirSync(path)
  } else {
    unlinkSync(path)
  }
}
