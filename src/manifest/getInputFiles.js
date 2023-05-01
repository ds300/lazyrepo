import glob from 'fast-glob'
import path, { isAbsolute, join } from 'path'
import pc from 'picocolors'
import { Config } from '../config/config.js'
import { readdirSync, statSync } from '../fs.js'
import { logger } from '../logger/logger.js'
import { createTimer } from '../utils/createTimer.js'
import { uniq } from '../utils/uniq.js'

/**
 * @param {{task: import('../types.js').ScheduledTask, includes: string[], excludes: string[], workspaceRoot: string}} param
 */
function globCacheConfig({ includes, excludes, task, workspaceRoot }) {
  /**
   * @type {Set<string>}
   */
  const files = new Set()

  for (const pattern of includes) {
    const timer = createTimer()
    for (const file of glob.sync(pattern, {
      cwd: task.workspace.dir,
      ignore: [join(workspaceRoot, '**/node_modules/**'), ...excludes],
      absolute: true,
    })) {
      if (statSync(file).isDirectory()) {
        visitAllFiles(file, (filePath) => files.add(filePath))
      } else {
        files.add(path.relative(workspaceRoot, file))
      }
    }
    // todo: always log this if verbose
    if (timer.getElapsedMs() > 100) {
      task.logger.note(
        `finding files matching ${path.relative(
          process.cwd(),
          isAbsolute(pattern) ? pattern : join(task.workspace.dir, pattern),
        )} took ${pc.cyan(timer.formatElapsedTime())}`,
      )
    }
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

  const localFiles = globCacheConfig({
    task,
    workspaceRoot: tasks.config.project.root.dir,
    includes: makeGlobsAbsolute(
      uniq([...baseCacheConfig.include, ...cacheConfig.inputs.include]),
      tasks.config,
      task.workspace.dir,
    ),
    excludes: makeGlobsAbsolute(
      uniq([...baseCacheConfig.exclude, ...cacheConfig.inputs.exclude]),
      tasks.config,
      task.workspace.dir,
    ),
  })

  return [...new Set([...localFiles, ...extraFiles])].sort()
}

export const ALL_WORKSPACES_MACRO = '<allWorkspaceDirs>'
export const ROOT_DIR_MACRO = '<rootDir>'

/**
 * @param {string[]} arr
 * @param {Config} config
 * @param {string} taskDir
 * @returns
 */
export const makeGlobsAbsolute = (arr, config, taskDir) => {
  const workspaceRoot = config.project.root.dir
  const allWorkspaceDirs = [...config.project.workspacesByDir.keys()].map((dir) =>
    path.relative(workspaceRoot, dir),
  )
  const allWorkspaceDirsGlob = workspaceRoot + `/{${allWorkspaceDirs.join(',')}}`
  return arr.map((str) => {
    const allWorkspaceIdx = str.indexOf(ALL_WORKSPACES_MACRO)
    if (allWorkspaceIdx > 0) {
      throw logger.fail(
        `Invalid glob: '${str}'. ${ALL_WORKSPACES_MACRO} must be at the start of the string.`,
      )
    }

    const rootDirIdx = str.indexOf(ROOT_DIR_MACRO)
    if (rootDirIdx > 0) {
      throw logger.fail(
        `Invalid glob: '${str}'. ${ROOT_DIR_MACRO} must be at the start of the string.`,
      )
    }

    if (allWorkspaceIdx === 0) {
      return str.replace(ALL_WORKSPACES_MACRO, allWorkspaceDirsGlob)
    } else if (rootDirIdx === 0) {
      return str.replace(ROOT_DIR_MACRO, workspaceRoot)
    } else if (str.startsWith('/')) {
      return str
    } else {
      return path.join(taskDir, str)
    }
  })
}

/**
 *
 * @param {string} dir
 * @param {(filePath: string) => void} visit
 */
function visitAllFiles(dir, visit) {
  for (const fileName of readdirSync(dir)) {
    const fullPath = path.join(dir, fileName)
    if (statSync(fullPath).isDirectory()) {
      visitAllFiles(fullPath, visit)
    } else {
      visit(fullPath)
    }
  }
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

  const localFiles = globCacheConfig({
    task,
    workspaceRoot: tasks.config.project.root.dir,
    includes: makeGlobsAbsolute(cacheConfig.outputs.include, tasks.config, task.workspace.dir),
    excludes: makeGlobsAbsolute(cacheConfig.outputs.exclude, tasks.config, task.workspace.dir),
  })

  return [...localFiles].sort()
}
