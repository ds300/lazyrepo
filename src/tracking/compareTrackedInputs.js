import { existsSync, readFileSync } from '../fs.js'
import { normalize, relative } from '../path.js'

/**
 * @typedef {Object} FileAccess
 * @property {string} path
 * @property {string} mode
 */

/**
 * Parse an fspy-trace JSON file and return sorted relative read paths
 * within the project root. Callers are responsible for applying any
 * exclude patterns (e.g. node_modules, dist, .git).
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

  const normalizedProjectRoot = normalize(projectRoot)
  const comparableProjectRoot =
    process.platform === 'win32' ? normalizedProjectRoot.toLowerCase() : normalizedProjectRoot

  /** @type {Set<string>} */
  const trackedReadPaths = new Set()
  for (const access of accesses) {
    if (access.mode === 'readdir') {
      continue
    }
    if (access.mode !== 'read' && !access.mode.includes('read')) {
      continue
    }
    const normalizedAccessPath = normalize(access.path)
    const comparableAccessPath =
      process.platform === 'win32' ? normalizedAccessPath.toLowerCase() : normalizedAccessPath

    if (!comparableAccessPath.startsWith(comparableProjectRoot)) {
      continue
    }
    const relativePath = relative(normalizedProjectRoot, normalizedAccessPath)
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
