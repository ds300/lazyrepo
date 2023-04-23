import { join } from 'path'
import { readdir, rmdir, stat, unlink } from './fs.js'

/**
 * @param {string} path
 */
export async function naiveRimraf(path) {
  try {
    const isDir = (await stat(path)).isDirectory()
    if (isDir) {
      for (const file of await readdir(path)) {
        const fullPath = join(path, file)
        await naiveRimraf(fullPath)
      }
      await rmdir(path)
    } else {
      await unlink(path)
    }
  } catch (e) {
    // ignore
  }
}
