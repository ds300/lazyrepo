import { unlink } from './fs.js'

/**
 * @param {string} path
 */
export async function unlinkIfExists(path) {
  try {
    return await unlink(path)
  } catch (_e) {
    return null
  }
}
