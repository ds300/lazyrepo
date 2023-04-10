import kleur from 'kleur'
import { cpus } from 'os'
import { isAbsolute, relative } from 'path'
import { runTaskIfNeeded } from './runTask.js'
import { workspaceRoot } from './workspaceRoot.js'

/**
 *
 * @param {string} cwd
 * @param {string} taskName
 * @returns {string}
 */
export function taskKey(cwd, taskName) {
  if (!isAbsolute(cwd)) throw new Error(`taskKey: cwd must be absolute: ${cwd}`)
  return `${relative(workspaceRoot, cwd)}:${taskName}`
}

const numCpus = cpus().length

const maxConcurrentTasks = Math.max(1, numCpus - 1)

/**
 * @typedef {Object} TaskGraphProps
 *
 * @property {import('../index.js').LazyConfig} config
 * @property {import('./types.js').RepoDetails} repoDetails
 * @property {import('./types.js').CLITaskDescription[]} taskDescriptors
 * @property {string[]} [filteredPackages]
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
  constructor({ config, repoDetails, taskDescriptors, filteredPackages }) {
    this.config = config
    this.repoDetails = repoDetails

    if (filteredPackages?.length === 0) {
      filteredPackages = undefined
    }

    /**
     * @type {Array<import('kleur').Color>}
     */
    const colors = [kleur.cyan, kleur.magenta, kleur.yellow, kleur.blue, kleur.green]
    let nextColorIndex = 0

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
        cwd: dir,
        status: 'pending',
        outputFiles: [],
        dependencies: [],
        terminalPrefix: colors[nextColorIndex++ % colors.length](key),
        inputManifestCacheKey: null,
        packageDetails,
      }
      const result = this.allTasks[key]

      for (const depTaskName of Object.keys(task.runsAfter ?? {})) {
        enqueueTask(
          { taskName: depTaskName, extraArgs: [], filterPaths: [], force: taskDescriptor.force },
          result.dependencies,
        )
      }

      if (task.independent !== true) {
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
      if (task.topLevel && !filteredPackages) {
        dependencies?.push(taskKey(workspaceRoot, taskDescriptor.taskName))
        visit({
          task,
          taskDescriptor,
          dir: workspaceRoot,
          packageDetails: null,
        })
        return
      }

      for (const packageName of filteredPackages ?? Object.keys(this.repoDetails.packagesByName)) {
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
    /**
     * @type {(err: any) => any}
     */
    let reject = () => {}
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })

    const tick = () => {
      const runningTasks = this.allRunningTasks()
      const readyTasks = this.allReadyTasks()
      const failedTasks = this.allFailedTasks()

      if (runningTasks.length === 0 && readyTasks.length === 0 && failedTasks.length === 0) {
        return resolve(null)
      }

      if (failedTasks.length > 0 && runningTasks.length === 0) {
        return reject(new Error(`Failed tasks: ${failedTasks.join(', ')}`))
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
      const didNeedToRun = await runTaskIfNeeded(this.allTasks[taskKey], this)
      this.allTasks[taskKey].status = didNeedToRun ? 'success:eager' : 'success:lazy'
      tick()
    }

    tick()

    return await promise
  }
}
