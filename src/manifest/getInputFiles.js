import glob from 'fast-glob'
import path, { isAbsolute, join } from 'path'
import pc from 'picocolors'
import { createTimer } from '../createTimer.js'
import { readdirSync, statSync } from '../fs.js'
import { uniq } from '../uniq.js'

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
        `Finding files matching ${path.relative(
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
 * @param {import('../TaskGraph.js').TaskGraph} tasks
 * @param {import('../types.js').ScheduledTask} task
 * @param {string[]} extraFiles
 * @returns
 */
export function getInputFiles(tasks, task, extraFiles) {
  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.taskName)

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
      tasks.config.project.root.dir,
      task.workspace.dir,
    ),
    excludes: makeGlobsAbsolute(
      uniq([...baseCacheConfig.exclude, ...cacheConfig.inputs.exclude]),
      tasks.config.project.root.dir,
      task.workspace.dir,
    ),
  })

  return [...new Set([...localFiles, ...extraFiles])].sort()
}

/**
 * @param {string[]} arr
 * @param {string} workspaceRoot
 * @param {string} taskDir
 * @returns
 */
const makeGlobsAbsolute = (arr, workspaceRoot, taskDir) =>
  arr.map((str) => {
    if (str.startsWith('<rootDir>/')) {
      return path.join(workspaceRoot, str.replace('<rootDir>/', ''))
    } else if (str.startsWith('/')) {
      return str
    } else {
      return path.join(taskDir, str)
    }
  })
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
