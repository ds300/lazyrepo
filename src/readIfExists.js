import { readFile } from './fs.js'

/**
 * @param {string} path
 */
export async function readIfExists(path) {
  try {
    return await readFile(path, 'utf-8')
  } catch (_e) {
    return null
  }
}
