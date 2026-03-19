import { existsSync, readFileSync } from '../fs.js'
import { relative } from '../path.js'

/**
 * @typedef {Object} FileAccess
 * @property {string} path
 * @property {string} mode
 */

/**
 * @typedef {Object} TrackingComparison
 * @property {string[]} underSpecified - Files read by the task but not in glob-based inputs
 * @property {string[]} overSpecified - Files in glob-based inputs that were never read
 * @property {string[]} trackedReads - All tracked read paths (relative to project root)
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
 * Compare file accesses tracked by fspy-trace against the glob-based input file list.
 *
 * @param {string} trackingJsonPath - Path to the fspy-trace output JSON
 * @param {string[]} globInputFiles - Relative paths from getInputFiles()
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {TrackingComparison | null} - null if the tracking file doesn't exist or can't be parsed
 */
export function compareTrackedInputs(trackingJsonPath, globInputFiles, projectRoot) {
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
    if (access.mode !== 'read' && access.mode !== 'readdir' && !access.mode.includes('read')) {
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

  const globInputSet = new Set(globInputFiles)
  const trackedReads = [...trackedReadPaths].sort()

  const underSpecified = trackedReads.filter((p) => !globInputSet.has(p))
  const overSpecified = globInputFiles.filter((p) => !trackedReadPaths.has(p))

  return { underSpecified, overSpecified, trackedReads }
}
