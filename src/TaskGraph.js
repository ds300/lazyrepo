import glob from 'fast-glob'
import { cpus } from 'os'
import { join } from 'path'
import { existsSync, readFileSync } from './fs.js'
import { isTest } from './isTest.js'
import { logger } from './logger/logger.js'
import { runTaskIfNeeded } from './runTask.js'

/**
 * @typedef {Object} TaskKeyProps
 * @property {string} taskDir
 * @property {string} taskName
 * @property {string} workspaceRoot
 */

const numCpus = cpus().length

const maxConcurrentTasks = process.env.__test__FORCE_PARALLEL
  ? 2
  : isTest
  ? 1
  : Math.max(1, numCpus - 1)

/**
 * @typedef {Object} TaskGraphProps
 *
 * @property {import('./config.js').Config} config
 * @property {import('./types.js').RequestedTask[]} requestedTasks
 */

export class TaskGraph {
  /**
   * @readonly
   * @type {import('./config.js').Config}
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
  constructor({ config, requestedTasks }) {
    this.config = config

    /**
     * @param {{ requestedTask: import('./types.js').RequestedTask, dir: string, packageDetails: import('./types.js').PackageDetails | null }} arg
     * @returns
     */
    const visit = ({ requestedTask, dir, packageDetails }) => {
      const taskConfig = this.config.getTaskConfig(dir, requestedTask.taskName)
      const key = this.config.getTaskKey(dir, requestedTask.taskName)
      if (this.allTasks[key]) {
        return
      }
      this.allTasks[key] = {
        key,
        taskConfig: taskConfig,
        taskName: requestedTask.taskName,
        extraArgs: requestedTask.extraArgs,
        filterPaths: requestedTask.filterPaths,
        force: requestedTask.force,
        taskDir: dir,
        status: 'pending',
        outputFiles: [],
        dependencies: [],
        inputManifestCacheKey: null,
        packageDetails,
        logger: logger.task(key),
      }
      const result = this.allTasks[key]

      for (const depTaskName of Object.keys(taskConfig.runsAfter)) {
        enqueueTask(
          dir,
          { taskName: depTaskName, extraArgs: [], filterPaths: [], force: requestedTask.force },
          result.dependencies,
        )
      }

      if (taskConfig.runType !== 'independent') {
        for (const packageName of packageDetails?.localDeps ?? []) {
          const pkg = this.config.repoDetails.packagesByName[packageName]
          if (pkg.scripts?.[requestedTask.taskName]) {
            result.dependencies.push(this.config.getTaskKey(pkg.dir, requestedTask.taskName))
            visit({
              requestedTask,
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
     * @param {string} dir
     * @param {import('./types.js').RequestedTask} requestedTask
     * @param {string[]} [dependencies]
     * @returns
     */
    const enqueueTask = (dir, requestedTask, dependencies) => {
      const rootTaskConfig = this.config.getTaskConfig(dir, requestedTask.taskName)
      if (rootTaskConfig.runType === 'top-level') {
        dependencies?.push(
          this.config.getTaskKey(this.config.workspaceRoot, requestedTask.taskName),
        )
        visit({
          requestedTask,
          dir: this.config.workspaceRoot,
          packageDetails: null,
        })
        return
      }

      /** @type {Array<string> | null} */
      const filteredPackageNames = requestedTask.filterPaths.length
        ? glob
            .sync(requestedTask.filterPaths, { onlyDirectories: true })
            .filter((dir) => existsSync(join(dir, 'package.json')))
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
            .map((dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name)
        : null

      for (const packageName of filteredPackageNames ??
        Object.keys(this.config.repoDetails.packagesByName)) {
        const pkg = this.config.repoDetails.packagesByName[packageName]
        if (pkg.scripts?.[requestedTask.taskName]) {
          dependencies?.push(this.config.getTaskKey(pkg.dir, requestedTask.taskName))
          visit({
            requestedTask,
            dir: pkg.dir,
            packageDetails: pkg,
          })
        }
      }
    }

    for (const requestedTask of requestedTasks) {
      enqueueTask(process.cwd(), requestedTask)
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
      const { taskName, taskConfig } = this.allTasks[key]
      const singleThreaded = taskConfig.parallel === false
      if (singleThreaded && inBandTaskNames.has(taskName)) {
        return false
      }

      inBandTaskNames.add(taskName)
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return resolve(null)
      }

      if (failedTasks.length > 0 && runningTasks.length === 0) {
        // some tasks failed, and there are no more running tasks
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await promise
  }
}
