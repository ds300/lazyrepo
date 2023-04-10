import glob from 'fast-glob'
import fs from 'fs'
import kleur from 'kleur'
import path from 'path'
import { getTask } from '../config.js'
import { timeSince } from '../log.js'
import { workspaceRoot } from '../workspaceRoot.js'

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
 * @param {import('../types.js').ScheduledTask} task
 * @param {string[]} extraFiles
 * @returns
 */
export async function getInputFiles(task, extraFiles) {
  const { cache } = (await getTask({ taskName: task.taskName })) ?? {}

  if (cache === 'none') {
    return null
  }

  /**
   * @type {Set<string>}
   */
  const files = new Set(extraFiles)

  const { include, exclude } = extractGlobPattern(cache?.inputs)

  const includes = getIncludes(include)
  const excludes = getExcludes(exclude)

  for (const pattern of includes) {
    const start = Date.now()
    for (const file of glob.sync(pattern, {
      cwd: task.cwd,
      ignore: ['node_modules', '**/node_modules', ...excludes],
    })) {
      const fullPath = path.relative(workspaceRoot, path.join(task.cwd, file))
      if (fs.statSync(fullPath).isDirectory()) {
        visitAllFiles(fullPath, (filePath) => files.add(filePath))
      } else {
        files.add(fullPath)
      }
    }
    // todo: always log this if verbose
    if (Date.now() - start > 100) {
      console.log(
        task.terminalPrefix,
        kleur.gray(`Searching ${pattern} took ${kleur.cyan(timeSince(start))}`),
      )
    }
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
