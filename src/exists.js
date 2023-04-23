import { access, constants } from './fs.js'

/**
 * @param {string} path
 */
export async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (_e) {
    return false
  }
}
