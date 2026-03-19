import { existsSync, readFileSync } from '../fs.js'
import { relative } from '../path.js'

/**
 * @typedef {Object} FileAccess
 * @property {string} path
 * @property {string} mode
 */

const IGNORED_PATH_SEGMENTS = [
  'node_modules',
  '.git',
  '/tmp/',
  '/private/tmp/',
  '/var/',
  '/dev/',
  '/proc/',
  '/sys/',
  '/etc/',
  '/usr/lib/',
  '/usr/share/',
  '/System/',
  '/Library/',
  '/Applications/',
  'fspy',
]

/**
 * @param {string} path
 * @returns {boolean}
 */
function shouldIgnorePath(path) {
  return IGNORED_PATH_SEGMENTS.some((segment) => path.includes(segment))
}

/**
 * Parse an fspy-trace JSON file and return sorted relative read paths.
 *
 * @param {string} trackingJsonPath - Path to the fspy-trace output JSON
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {string[] | null} Sorted relative paths, or null if the file doesn't exist or can't be parsed
 */
export function getTrackedReadPaths(trackingJsonPath, projectRoot) {
  if (!existsSync(trackingJsonPath)) {
    return null
  }

  /** @type {FileAccess[]} */
  let accesses
  try {
    const raw = readFileSync(trackingJsonPath, 'utf-8')
    accesses = /** @type {FileAccess[]} */ (JSON.parse(raw))
  } catch {
    return null
  }

  /** @type {Set<string>} */
  const trackedReadPaths = new Set()
  for (const access of accesses) {
    if (access.mode === 'readdir') {
      continue
    }
    if (access.mode !== 'read' && !access.mode.includes('read')) {
      continue
    }
    if (!access.path.startsWith(projectRoot)) {
      continue
    }
    if (shouldIgnorePath(access.path)) {
      continue
    }
    const relativePath = relative(projectRoot, access.path)
    if (!relativePath || relativePath.startsWith('..')) {
      continue
    }
    trackedReadPaths.add(relativePath)
  }

  return [...trackedReadPaths].sort()
}

/**
 * Compare file accesses tracked by fspy-trace against the glob-based input file list.
 *
 * @param {string} trackingJsonPath - Path to the fspy-trace output JSON
 * @param {string[]} globInputFiles - Relative paths from getInputFiles()
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {{ underSpecified: string[], overSpecified: string[], trackedReads: string[] } | null}
 */
export function compareTrackedInputs(trackingJsonPath, globInputFiles, projectRoot) {
  const trackedReads = getTrackedReadPaths(trackingJsonPath, projectRoot)
  if (!trackedReads) return null

  const globInputSet = new Set(globInputFiles)
  const trackedSet = new Set(trackedReads)

  const underSpecified = trackedReads.filter((p) => !globInputSet.has(p))
  const overSpecified = globInputFiles.filter((p) => !trackedSet.has(p))

  return { underSpecified, overSpecified, trackedReads }
}
