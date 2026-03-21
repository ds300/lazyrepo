import assert from 'assert'
import micromatch from 'micromatch'
import pc from 'picocolors'
import { statSync } from '../fs.js'
import { glob } from '../glob/glob.js'
import { isAbsolute, join, relative } from '../path.js'
import { getTrackedReadPaths } from '../tracking/compareTrackedInputs.js'
import { createTimer } from '../utils/createTimer.js'
import { uniq } from '../utils/uniq.js'

/**
 * @param {{task: import('../types.js').ScheduledTask, includes: string[], excludes: string[], workspaceRoot: string}} param
 */
function globCacheConfig({ includes, excludes, task, workspaceRoot }) {
  const timer = createTimer()

  const files = glob.sync(includes, {
    cwd: task.workspace.dir,
    ignore: [join(workspaceRoot, '**/node_modules/**'), ...excludes],
    expandDirectories: true,
    absolute: true,
  })

  // todo: always log this if verbose
  if (timer.getElapsedMs() > 100) {
    task.logger.note(`finding files took ${pc.cyan(timer.formatElapsedTime())}`)
  }

  return files.map((f) => relative(workspaceRoot, f))
}

/**
 *
 * @param {import('../tasks/TaskGraph.js').TaskGraph} tasks
 * @param {import('../types.js').ScheduledTask} task
 * @param {string[]} extraFiles
 * @returns
 */
export function getInputFiles(tasks, task, extraFiles) {
  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)

  const cacheConfig = taskConfig.cache
  if (cacheConfig === 'none') {
    return null
  }

  const baseCacheConfig = tasks.config.getBaseCacheConfig()

  const includePatterns = uniq([...baseCacheConfig.include, ...cacheConfig.inputs.include])
  const excludePatterns = uniq([...baseCacheConfig.exclude, ...cacheConfig.inputs.exclude])

  const rootDir = tasks.config.project.root.dir
  const taskDir = task.workspace.dir
  const allWorkspaceDirs = [...tasks.config.project.workspacesByDir.keys()]

  const expandedExcludes = expandGlobPaths({
    patterns: excludePatterns,
    rootDir,
    taskDir,
    allWorkspaceDirs,
  })

  const localFiles = globCacheConfig({
    task,
    workspaceRoot: tasks.config.project.root.dir,
    includes: expandGlobPaths({
      patterns: includePatterns,
      rootDir,
      taskDir,
      allWorkspaceDirs,
    }),
    excludes: expandedExcludes,
  })

  const trackedFileExcludes = [
    ...expandedExcludes,
    join(rootDir, '**/node_modules/**'),
    join(rootDir, '**/.git/**'),
  ]
  const trackedFiles = loadPreviousTrackedFiles(taskConfig, rootDir, trackedFileExcludes)

  return [...new Set([...localFiles, ...extraFiles, ...trackedFiles])].sort()
}

/**
 * Load tracked read paths from a previous run's tracking JSON, filtering out
 * files that no longer exist, files matching exclude patterns, and skipping
 * if auto-tracking is disabled.
 *
 * @param {import('../config/config.js').TaskConfig} taskConfig
 * @param {string} projectRoot
 * @param {string[]} expandedExcludes - Absolute glob patterns to exclude
 * @returns {string[]}
 */
function loadPreviousTrackedFiles(taskConfig, projectRoot, expandedExcludes) {
  if (taskConfig.cache === 'none' || taskConfig.cache.auto === false) {
    return []
  }

  const trackingPath = taskConfig.getManifestPath().replace('manifest.tsv', 'tracked-inputs.json')
  const paths = getTrackedReadPaths(trackingPath, projectRoot)
  if (!paths) return []

  return paths.filter((p) => {
    const full = join(projectRoot, p)
    if (expandedExcludes.length > 0 && micromatch.isMatch(full, expandedExcludes)) {
      return false
    }
    try {
      return statSync(full).isFile()
    } catch {
      return false
    }
  })
}

export const ALL_WORKSPACES_MACRO = '<allWorkspaceDirs>'
export const ROOT_DIR_MACRO = '<rootDir>'

/**
 * @typedef {Object} ExpandGlobsProps
 *
 * @property {string[]} patterns
 * @property {string} rootDir
 * @property {string} taskDir
 * @property {string[]} allWorkspaceDirs
 */

/**
 * @param {ExpandGlobsProps} props
 * @returns {string[]}
 */
export const expandGlobPaths = ({ patterns, rootDir, taskDir, allWorkspaceDirs }) => {
  assert(isAbsolute(rootDir), 'rootDir must be absolute')
  assert(isAbsolute(taskDir), 'taskDir must be absolute')
  assert(allWorkspaceDirs.every(isAbsolute), 'allWorkspaceDirs must be absolute')

  return patterns
    .map((p) => p.replaceAll(ROOT_DIR_MACRO, rootDir))
    .flatMap((p) => {
      if (p.includes(ALL_WORKSPACES_MACRO)) {
        return allWorkspaceDirs.map((dir) => p.replaceAll(ALL_WORKSPACES_MACRO, dir))
      } else {
        return [p]
      }
    })
    .map((p) => {
      if (isAbsolute(p)) {
        return p
      } else {
        return join(taskDir, p)
      }
    })
}

/**
 *
 * @param {import('../tasks/TaskGraph.js').TaskGraph} tasks
 * @param {import('../types.js').ScheduledTask} task
 * @returns
 */
export function getOutputFiles(tasks, task) {
  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)

  const cacheConfig = taskConfig.cache
  if (cacheConfig === 'none' || cacheConfig.outputs.include.length === 0) {
    return null
  }

  const rootDir = tasks.config.project.root.dir
  const taskDir = task.workspace.dir
  const allWorkspaceDirs = [...tasks.config.project.workspacesByDir.keys()]

  const localFiles = globCacheConfig({
    task,
    workspaceRoot: tasks.config.project.root.dir,
    includes: expandGlobPaths({
      patterns: cacheConfig.outputs.include,
      taskDir,
      rootDir,
      allWorkspaceDirs,
    }),
    excludes: expandGlobPaths({
      patterns: cacheConfig.outputs.exclude,
      taskDir,
      rootDir,
      allWorkspaceDirs,
    }),
  })

  return [...localFiles].sort()
}
