import { runIfNeeded } from './commands/run-if-needed'
import { LazyConfig, Task } from './config'
import { PackageDetails, RepoDetails } from './workspace'

type TaskStatus = 'pending' | 'running' | 'success:eager' | 'success:lazy' | 'failure'

interface ScheduledTask {
  taskName: string
  cwd: string
  status: TaskStatus
  outputFiles: string[]
  dependencies: string[]
}

function taskKey({ taskName, cwd }: { taskName: string; cwd: string }) {
  return `${cwd}:${taskName}`
}

const numCpus = require('os').cpus().length

const maxConcurrentTasks = Math.max(1, numCpus - 1)

export class TaskGraph {
  readonly repoDetails: RepoDetails
  readonly config: LazyConfig
  readonly allTasks: Record<string, ScheduledTask> = {}
  readonly sortedTaskKeys: string[] = []

  constructor({
    config,
    repoDetails,
    endTasks,
    filteredPackages,
  }: {
    config: LazyConfig
    repoDetails: RepoDetails
    endTasks: string[]
    filteredPackages?: string[]
  }) {
    this.config = config
    this.repoDetails = repoDetails

    if (filteredPackages?.length === 0) {
      filteredPackages = undefined
    }

    const visit = ({
      task,
      taskName,
      dir,
      packageDetails,
    }: {
      task: Task
      taskName: string
      dir: string
      packageDetails: PackageDetails | null
    }) => {
      const key = taskKey({ taskName, cwd: dir })
      if (this.allTasks[key]) {
        return
      }
      const result = (this.allTasks[key] = {
        taskName,
        cwd: dir,
        status: 'pending',
        outputFiles: [],
        dependencies: [] as string[],
      })

      for (const depTaskName of Object.keys(task.dependsOn ?? {})) {
        enqueueTask(depTaskName, result.dependencies)
      }

      for (const packageName of packageDetails?.localDeps ?? []) {
        const pkg = this.repoDetails.packagesByName[packageName]
        if (pkg.scripts?.[taskName]) {
          result.dependencies.push(taskKey({ taskName, cwd: pkg.dir }))
          visit({
            task,
            taskName,
            dir: pkg.dir,
            packageDetails: pkg,
          })
        }
      }

      this.sortedTaskKeys.push(key)
    }

    const enqueueTask = (taskName: string, dependencies?: string[]) => {
      const task = this.config.tasks?.[taskName] ?? {}
      if (task.topLevel && !filteredPackages) {
        dependencies?.push(taskKey({ taskName, cwd: './' }))
        visit({
          task,
          taskName,
          dir: './',
          packageDetails: null,
        })
        return
      }

      for (const packageName of filteredPackages ?? Object.keys(this.repoDetails.packagesByName)) {
        const pkg = this.repoDetails.packagesByName[packageName]
        if (pkg.scripts?.[taskName]) {
          dependencies?.push(taskKey({ taskName, cwd: pkg.dir }))
          visit({
            task,
            taskName,
            dir: pkg.dir,
            packageDetails: pkg,
          })
        }
      }
    }

    for (const taskName of endTasks) {
      enqueueTask(taskName)
    }
  }

  isTaskReady(key: string) {
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
    let resolve: () => any = () => {}
    let reject: (e: any) => any = () => {}
    const promise = new Promise<void>((res, rej) => {
      resolve = res as any
      reject = rej as any
    })

    const tick = () => {
      const runningTasks = this.allRunningTasks()
      const readyTasks = this.allReadyTasks()
      const failedTasks = this.allFailedTasks()

      if (runningTasks.length === 0 && readyTasks.length === 0 && failedTasks.length === 0) {
        return resolve()
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
    const runTask = async (taskKey: string) => {
      const didNeedToRun = await runIfNeeded(this.allTasks[taskKey])
      this.allTasks[taskKey].status = didNeedToRun ? 'success:eager' : 'success:lazy'
      tick()
    }

    tick()

    return await promise
  }
}
