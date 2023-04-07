import glob from 'fast-glob'
import fs from 'fs'
import path from 'path'
import { getTask } from '../config.js'
import { log } from '../log.js'

/**
 * @param {string[] | undefined} includes
 * @returns {string[]}
 */
function getIncludes(includes) {
  if (!includes) {
    return ['**/*']
  }
  if (typeof includes === 'string') {
    return [includes]
  }
  return includes
}

/**
 * @param {string[] | undefined} excludes
 * @returns {string[]}
 */
function getExcludes(excludes) {
  if (!excludes) {
    return []
  }
  if (typeof excludes === 'string') {
    return [excludes]
  }
  return excludes
}

/**
 *
 * @param {import('../types.js').GlobConfig | null | undefined} glob
 * @returns
 */
function extractGlobPattern(glob) {
  if (!glob) {
    return {
      include: ['**/*'],
      exclude: [],
    }
  }
  if (Array.isArray(glob)) {
    return {
      include: glob,
      exclude: [],
    }
  }

  return glob
}

/**
 *
 * @param {{taskName: string, cwd: string}} arg
 * @returns
 */
export async function getInputFiles({ taskName, cwd }) {
  const { cache } = (await getTask({ taskName })) ?? {}

  if (cache === 'none') {
    return null
  }

  /**
   * @type {Set<string>}
   */
  const files = new Set()

  const { include, exclude } = extractGlobPattern(cache?.inputs)

  const includes = getIncludes(include)
  const excludes = getExcludes(exclude)

  for (const pattern of includes) {
    await log.timedStep('Finding inputs ' + pattern, () => {
      for (const file of glob.sync(pattern, {
        cwd,
        ignore: ['node_modules', '.git', '.lazy', ...excludes],
        dot: true,
      })) {
        const fullPath = path.join(cwd, file)
        if (fs.statSync(fullPath).isDirectory()) {
          visitAllFiles(fullPath, (filePath) => files.add(filePath))
        } else {
          files.add(fullPath)
        }
      }
    })
  }

  return [...files].sort()
}

/**
 *
 * @param {string} dir
 * @param {(filePath: string) => void} visit
 */
function visitAllFiles(dir, visit) {
  for (const fileName of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, fileName)
    if (fs.statSync(fullPath).isDirectory()) {
      visitAllFiles(fullPath, visit)
    } else {
      visit(fullPath)
    }
  }
}
