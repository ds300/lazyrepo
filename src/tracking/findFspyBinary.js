import { execFileSync } from 'child_process'
import { existsSync } from '../fs.js'
import { join } from '../path.js'

/**
 * Locate the fspy-trace binary.
 *
 * Search order:
 *   1. FSPY_TRACE_BIN environment variable
 *   2. Local build at <projectRoot>/fspy-trace/target/release/fspy-trace
 *   3. On PATH via `which`
 *
 * @param {string} projectRoot
 * @returns {string | null}
 */
export function findFspyBinary(projectRoot) {
  if (process.env.FSPY_TRACE_BIN) {
    const envPath = process.env.FSPY_TRACE_BIN
    if (existsSync(envPath)) {
      return envPath
    }
  }

  const suffix = process.platform === 'win32' ? '.exe' : ''
  const localBuildPath = join(projectRoot, 'fspy-trace', 'target', 'release', `fspy-trace${suffix}`)
  if (existsSync(localBuildPath)) {
    return localBuildPath
  }

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = execFileSync(cmd, ['fspy-trace'], { encoding: 'utf-8' }).trim()
    if (result && existsSync(result)) {
      return result
    }
  } catch {
    // not on PATH
  }

  return null
}
