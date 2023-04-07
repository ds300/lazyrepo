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

  async startNextTask() {
    const nextTask = this.sortedTaskKeys.find((key) => this.allTasks[key].status === 'pending')
    if (nextTask) {
      try {
        this.allTasks[nextTask].status = 'running'
        const didNeedToRun = await runIfNeeded(this.allTasks[nextTask])
        this.allTasks[nextTask].status = didNeedToRun ? 'success:eager' : 'success:lazy'
        return true
      } catch (e) {
        this.allTasks[nextTask].status = 'failure'
        throw e
      }
    }
    return false
  }
}
