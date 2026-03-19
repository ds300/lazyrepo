import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { existsSync } from '../fs.js'
import { dirname, join } from '../path.js'

const suffix = process.platform === 'win32' ? '.exe' : ''
const binaryName = `fspy-trace${suffix}`
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundledPath = join(packageRoot, 'assets', binaryName)
const devBuildPath = join(packageRoot, 'fspy-trace', 'target', 'release', binaryName)

/**
 * Locate the fspy-trace binary.
 *
 * Search order:
 *   1. FSPY_TRACE_BIN environment variable
 *   2. Bundled binary shipped with the lazyrepo package
 *   3. Local dev build (relative to the lazyrepo package root)
 *   4. On PATH via `which`/`where`
 *
 * @returns {string}
 */
export function findFspyBinary() {
  if (process.env.FSPY_TRACE_BIN) {
    const envPath = process.env.FSPY_TRACE_BIN
    if (existsSync(envPath)) {
      return envPath
    }
    throw new Error(`FSPY_TRACE_BIN is set to '${envPath}' but the file does not exist.`)
  }

  if (existsSync(bundledPath)) {
    return bundledPath
  }

  if (existsSync(devBuildPath)) {
    return devBuildPath
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

  throw new Error(
    'Could not find fspy-trace binary. Install it or set the FSPY_TRACE_BIN environment variable.',
  )
}
