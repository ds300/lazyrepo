import kleur from 'kleur'
import micromatch from 'micromatch'
import { cpus } from 'os'
import { isAbsolute, join } from 'path'
import { isTest } from './isTest.js'
import { logger } from './logger/logger.js'
import { runTaskIfNeeded } from './runTask.js'
import { uniq } from './uniq.js'

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
 * @property {import('./config/config.js').Config} config
 * @property {import('./types.js').RequestedTask[]} requestedTasks
 */

export class TaskGraph {
  /**
   * @readonly
   * @type {import('./config/config.js').Config}
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
     * @param {string[]} path
     * @param {{ requestedTask: import('./types.js').RequestedTask, taskDir: string, packageDetails: import('./types.js').PackageDetails | null }} arg
     * @returns
     */
    const visit = (path, { requestedTask, taskDir, packageDetails }) => {
      const taskConfig = this.config.getTaskConfig(taskDir, requestedTask.taskName)
      const key = this.config.getTaskKey(taskDir, requestedTask.taskName)
      if (this.allTasks[key]) {
        if (path.includes(key)) {
          logger.fail(
            `Circular dependency detected: \n${path.join('\n -> ')}\n -> ${kleur.bold(key)}`,
          )
          process.exit(1)
        }
        return
      }
      path = [...path, key]
      this.allTasks[key] = {
        key,
        taskConfig: taskConfig,
        taskName: requestedTask.taskName,
        extraArgs: requestedTask.extraArgs,
        force: requestedTask.force,
        taskDir,
        status: 'pending',
        outputFiles: [],
        dependencies: [],
        inputManifestCacheKey: null,
        packageDetails,
        logger: logger.task(key),
      }
      const result = this.allTasks[key]

      for (const [upstreamTaskName, upstreamTaskConfig] of taskConfig.runsAfterEntries) {
        /**
         * @type {string[]}
         */
        let filterPaths = []
        if (upstreamTaskConfig.in === 'self-and-dependencies') {
          filterPaths = [taskDir].concat(
            packageDetails?.localDeps.map(
              (dep) => this.config.repoDetails.packagesByName[dep].dir,
            ) ?? [],
          )
        } else if (upstreamTaskConfig.in === 'self-only') {
          filterPaths = [taskDir]
        }
        enqueueTask(
          path,
          {
            taskName: upstreamTaskName,
            extraArgs: [],
            force: requestedTask.force,
            filterPaths,
          },
          result.dependencies,
        )
      }

      if (taskConfig.execution !== 'independent') {
        for (const packageName of packageDetails?.localDeps ?? []) {
          const pkg = this.config.repoDetails.packagesByName[packageName]
          if (pkg.scripts?.[requestedTask.taskName]) {
            const depKey = this.config.getTaskKey(pkg.dir, requestedTask.taskName)
            result.dependencies.push(depKey)
            visit(path, {
              requestedTask,
              taskDir: pkg.dir,
              packageDetails: pkg,
            })
          }
        }
      }

      this.sortedTaskKeys.push(key)
    }

    /**
     *
     * @param {string[]} path
     * @param {import('./types.js').RequestedTask} requestedTask
     * @param {string[]} [dependencies]
     * @returns
     */
    const enqueueTask = (path, requestedTask, dependencies) => {
      if (this.isTopLevelTask(requestedTask.taskName)) {
        const key = this.config.getTaskKey(this.config.workspaceRoot, requestedTask.taskName)
        dependencies?.push(key)
        visit(path, {
          requestedTask,
          taskDir: this.config.workspaceRoot,
          packageDetails: null,
        })
        return
      }

      const dirs = filterPackageDirs(
        this.config.workspaceRoot,
        this.config.repoDetails,
        requestedTask.filterPaths,
      )
      for (const dir of dirs) {
        const packageDetails = this.config.repoDetails.packagesByDir[dir]
        if (packageDetails.scripts[requestedTask.taskName]) {
          const key = this.config.getTaskKey(dir, requestedTask.taskName)
          dependencies?.push(key)
          visit(path, {
            requestedTask,
            taskDir: dir,
            packageDetails,
          })
        }
      }
    }

    for (const requestedTask of requestedTasks) {
      enqueueTask([], requestedTask)
    }
  }

  /**
   * @param {string} taskName
   */
  isTopLevelTask(taskName) {
    return this.config.getTaskConfig(this.config.workspaceRoot, taskName).execution === 'top-level'
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
    return allReadyTasks
      .filter((key) => {
        const { taskName, taskConfig } = this.allTasks[key]
        const singleThreaded = taskConfig.parallel === false
        if (singleThreaded && inBandTaskNames.has(taskName)) {
          return false
        }

        inBandTaskNames.add(taskName)
        return true
      })
      .sort()
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

/**
 * Match a list of filter path globs against the list of package directories.
 *
 * @param {string} workspaceRoot
 * @param {import('./types.js').RepoDetails} repoDetails
 * @param {string[]} filterPaths
 */
function filterPackageDirs(workspaceRoot, repoDetails, filterPaths) {
  /** @type {Array<string> | null} */
  if (!filterPaths.length) {
    return Object.keys(repoDetails.packagesByDir)
  }

  const packageDirs = Object.keys(repoDetails.packagesByDir)

  return uniq(
    filterPaths.flatMap((pattern) =>
      micromatch.match(packageDirs, isAbsolute(pattern) ? pattern : join(workspaceRoot, pattern)),
    ),
  )
}
