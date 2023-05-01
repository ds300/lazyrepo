import { rmSync } from '../fs.js'

/**
 * @param {string} path
 */
export const rimraf = (path) => {
  rmSync(path, { recursive: true, force: true })
}
