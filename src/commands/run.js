import { getConfig } from '../config/config.js'
import { InteractiveLogger } from '../logger/InteractiveLogger.js'
import { logger } from '../logger/logger.js'
import { rainbow } from '../rainbow.js'
import { TaskGraph } from '../TaskGraph.js'
import { getRepoDetails } from '../workspace.js'
import { workspaceRoot } from '../workspaceRoot.js'

/**
 * @param {string} taskName
 * @param {import('../types.js').CLIOption} options
 */
export async function run(taskName, options) {
  const filterPaths = options.filter
    ? Array.isArray(options.filter)
      ? options.filter
      : [options.filter]
    : []
  /** @type {import('../types.js').CLITaskDescription[]} */
  const taskDescriptors = [
    {
      taskName: taskName,
      filterPaths,
      force: options.force,
      extraArgs: options['--'],
    },
  ]

  const tasks = new TaskGraph({
    config: await getConfig(),
    taskDescriptors,
    repoDetails: getRepoDetails(),
  })

  if (tasks.sortedTaskKeys.length === 0) {
    logger.fail(
      `No tasks found matching [${taskDescriptors
        .map((t) => t.taskName)
        .join(', ')}] in ${workspaceRoot}`,
    )
  }

  await tasks.runAllTasks()
  if (logger instanceof InteractiveLogger) logger.clearTasks()

  const failedTasks = tasks.allFailedTasks()

  if (failedTasks.length > 0) {
    logger.fail(`Failed tasks: ${failedTasks.join(', ')}`)
  }

  if (Object.entries(tasks.allTasks).every(([, task]) => task.status === 'success:lazy')) {
    logger.log('\n' + rainbow('>>> MAXIMUM LAZY'))
  }
}
