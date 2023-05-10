import { constants, copyFileSync, mkdirSync, utimesSync } from '../fs.js'
import { dirname } from '../path.js'

/**
 * @param {string} src
 * @param {string} dest
 * @param {Date} mtime
 */
export function copyFileWithMtime(src, dest, mtime) {
  try {
    copyFileSync(src, dest, constants.COPYFILE_FICLONE)
  } catch (_) {
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest, constants.COPYFILE_FICLONE)
  }
  utimesSync(dest, mtime, mtime)
}
