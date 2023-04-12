import glob from 'fast-glob'
import { existsSync, readFileSync } from 'fs'
import { cpus } from 'os'
import { isAbsolute, join, relative } from 'path'
import { logger } from './log.js'
import { runTaskIfNeeded } from './runTask.js'
import { workspaceRoot } from './workspaceRoot.js'

/**
 *
 * @param {string} taskDir
 * @param {string} taskName
 * @returns {string}
 */
export function taskKey(taskDir, taskName) {
  if (!isAbsolute(taskDir)) throw new Error(`taskKey: taskDir must be absolute: ${taskDir}`)
  return `${relative(workspaceRoot, taskDir) || '<rootDir>'}:${taskName}`
}

const numCpus = cpus().length

const maxConcurrentTasks = Math.max(1, numCpus - 1)

/**
 * @typedef {Object} TaskGraphProps
 *
 * @property {import('../index.js').LazyConfig} config
 * @property {import('./types.js').RepoDetails} repoDetails
 * @property {import('./types.js').CLITaskDescription[]} taskDescriptors
 */

export class TaskGraph {
  /**
   * @readonly
   * @type {import('./types.js').RepoDetails}
   */
  repoDetails
  /**
   * @readonly
   * @type {import('../index.js').LazyConfig}
   */
  config
  /**
   * @readonly
   * @type {Record<string, import('./types.js').ScheduledTask>}
   */
  allTasks = {}
  /**
   * @readonly
   * @type {string[]}
   */
  sortedTaskKeys = []

  /**
   * @param {TaskGraphProps} arg
   */
  constructor({ config, repoDetails, taskDescriptors }) {
    this.config = config
    this.repoDetails = repoDetails

    /**
     * @param {{ task: import('./types.js').TaskConfig, taskDescriptor: import('./types.js').CLITaskDescription, dir: string, packageDetails: import('./types.js').PackageDetails | null }} arg
     * @returns
     */
    const visit = ({ task, taskDescriptor, dir, packageDetails }) => {
      const key = taskKey(dir, taskDescriptor.taskName)
      if (this.allTasks[key]) {
        return
      }
      this.allTasks[key] = {
        key,
        taskName: taskDescriptor.taskName,
        extraArgs: taskDescriptor.extraArgs,
        filterPaths: taskDescriptor.filterPaths,
        force: taskDescriptor.force,
        taskDir: dir,
        status: 'pending',
        outputFiles: [],
        dependencies: [],
        inputManifestCacheKey: null,
        packageDetails,
        logger: logger.task(key),
      }
      const result = this.allTasks[key]

      for (const depTaskName of Object.keys(task.runsAfter ?? {})) {
        enqueueTask(
          { taskName: depTaskName, extraArgs: [], filterPaths: [], force: taskDescriptor.force },
          result.dependencies,
        )
      }

      if (task.runType !== 'independent') {
        for (const packageName of packageDetails?.localDeps ?? []) {
          const pkg = this.repoDetails.packagesByName[packageName]
          if (pkg.scripts?.[taskDescriptor.taskName]) {
            result.dependencies.push(taskKey(pkg.dir, taskDescriptor.taskName))
            visit({
              task,
              taskDescriptor,
              dir: pkg.dir,
              packageDetails: pkg,
            })
          }
        }
      }

      this.sortedTaskKeys.push(key)
    }

    /**
     *
     * @param {import('./types.js').CLITaskDescription} taskDescriptor
     * @param {string[]} [dependencies]
     * @returns
     */
    const enqueueTask = (taskDescriptor, dependencies) => {
      const task = this.config.tasks?.[taskDescriptor.taskName] ?? {}
      if (task.runType === 'top-level') {
        dependencies?.push(taskKey(workspaceRoot, taskDescriptor.taskName))
        visit({
          task,
          taskDescriptor,
          dir: workspaceRoot,
          packageDetails: null,
        })
        return
      }

      const filteredPackageNames = taskDescriptor.filterPaths.length
        ? glob
            .sync(taskDescriptor.filterPaths, { onlyDirectories: true })
            .filter((dir) => existsSync(join(dir, 'package.json')))
            .map((dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name)
        : null

      for (const packageName of filteredPackageNames ??
        Object.keys(this.repoDetails.packagesByName)) {
        const pkg = this.repoDetails.packagesByName[packageName]
        if (pkg.scripts?.[taskDescriptor.taskName]) {
          dependencies?.push(taskKey(pkg.dir, taskDescriptor.taskName))
          visit({
            task,
            taskDescriptor,
            dir: pkg.dir,
            packageDetails: pkg,
          })
        }
      }
    }

    for (const taskDescriptor of taskDescriptors) {
      enqueueTask(taskDescriptor)
    }
  }

  /**
   * @param {string} key
   * @returns
   */
  isTaskReady(key) {
    const task = this.allTasks[key]
    return (
      task.status === 'pending' &&
      task.dependencies.every((dep) => this.allTasks[dep].status.startsWith('success'))
    )
  }

  allReadyTasks() {
    const allReadyTasks = this.sortedTaskKeys.filter((key) => this.isTaskReady(key))
    const inBandTaskNames = new Set()
    // filter out duplicates for in-band tasks
    return allReadyTasks.filter((key) => {
      const task = this.allTasks[key]
      const inBand = this.config.tasks?.[task.taskName]?.parallel === false
      if (inBand && inBandTaskNames.has(task.taskName)) {
        return false
      }

      inBandTaskNames.add(task.taskName)
      return true
    })
  }

  allRunningTasks() {
    return this.sortedTaskKeys.filter((key) => this.allTasks[key].status === 'running')
  }

  allFailedTasks() {
    return this.sortedTaskKeys.filter((key) => this.allTasks[key].status === 'failure')
  }

  async runAllTasks() {
    /**
     * @type {(val: any) => any}
     */
    let resolve = () => {}
    const promise = new Promise((res) => {
      resolve = res
    })

    const tick = () => {
      const runningTasks = this.allRunningTasks()
      const readyTasks = this.allReadyTasks()
      const failedTasks = this.allFailedTasks()

      if (runningTasks.length === 0 && readyTasks.length === 0 && failedTasks.length === 0) {
        return resolve(null)
      }

      if (failedTasks.length > 0 && runningTasks.length === 0) {
        // some tasks failed, and there are no more running tasks
        return resolve(null)
      }

      if (failedTasks.length > 0) {
        // don't start any more tasks, just wait for the running ones to finish
        return
      }

      if (runningTasks.length >= maxConcurrentTasks) {
        // wait for tasks to finish before starting more
        return
      }

      if (readyTasks.length === 0) {
        // just wait for running tasks to finish
        return
      }

      // start as many tasks as we can
      const numTasksToStart = Math.min(maxConcurrentTasks - runningTasks.length, readyTasks.length)

      for (let i = 0; i < numTasksToStart; i++) {
        const taskKey = readyTasks[i]
        this.allTasks[taskKey].status = 'running'
        runTask(readyTasks[i])
      }

      return true
    }
    /**
     * @param {string} taskKey
     */
    const runTask = async (taskKey) => {
      const { didRunTask, didSucceed } = await runTaskIfNeeded(this.allTasks[taskKey], this)
      this.allTasks[taskKey].status = didSucceed
        ? didRunTask
          ? 'success:eager'
          : 'success:lazy'
        : 'failure'
      tick()
    }

    tick()

    return await promise
  }
}
