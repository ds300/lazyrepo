import assert from 'assert'
import pc from 'picocolors'
import { glob } from '../glob/glob.js'
import { isAbsolute, join } from '../path.js'
import { createTimer } from '../utils/createTimer.js'
import { uniq } from '../utils/uniq.js'

/**
 * @param {{task: import('../types.js').ScheduledTask, includes: string[], excludes: string[], workspaceRoot: string}} param
 */
function globCacheConfig({ includes, excludes, task, workspaceRoot }) {
  const timer = createTimer()

  const files = new Set(
    glob.sync(includes, {
      cwd: task.workspace.dir,
      ignore: [join(workspaceRoot, '**/node_modules/**'), ...excludes],
      expandDirectories: true,
    }),
  )

  // todo: always log this if verbose
  if (timer.getElapsedMs() > 100) {
    task.logger.note(`finding files took ${pc.cyan(timer.formatElapsedTime())}`)
  }

  return files
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

  const localFiles = globCacheConfig({
    task,
    workspaceRoot: tasks.config.project.root.dir,
    includes: expandGlobPaths({
      patterns: includePatterns,
      rootDir,
      taskDir,
      allWorkspaceDirs,
    }),
    excludes: expandGlobPaths({
      patterns: excludePatterns,
      rootDir,
      taskDir,
      allWorkspaceDirs,
    }),
  })

  return [...new Set([...localFiles, ...extraFiles])].sort()
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
