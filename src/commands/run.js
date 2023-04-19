import kleur from 'kleur'
import { dedent } from 'ts-dedent'
import { TaskGraph } from '../TaskGraph.js'
import { Config } from '../config/config.js'
import { InteractiveLogger } from '../logger/InteractiveLogger.js'
import { logger } from '../logger/logger.js'
import { rainbow } from '../rainbow.js'

/**
 * @param {{taskName: string, options: import('../types.js').CLIOption}} args
 */
export async function run({ taskName, options }) {
  const config = await Config.from(process.cwd())

  const filterPaths = options.filter
    ? Array.isArray(options.filter)
      ? options.filter
      : [options.filter]
    : []

  /** @type {import('../types.js').RequestedTask[]} */
  const requestedTasks = [
    {
      taskName: taskName,
      filterPaths,
      force: options.force,
      extraArgs: options['--'],
    },
  ]

  const tasks = new TaskGraph({
    config,
    requestedTasks,
  })

  if (tasks.sortedTaskKeys.length === 0) {
    logger.fail(
      `No tasks found matching [${requestedTasks.map((t) => t.taskName).join(', ')}] in ${
        config.workspaceRoot
      }`,
    )
  }

  await tasks.runAllTasks()
  if (logger instanceof InteractiveLogger) logger.clearTasks()

  const failedTasks = tasks.allFailedTasks()
  if (failedTasks.length > 0) {
    logger.fail(`Failed tasks: ${failedTasks.join(', ')}`)
  }

  const stats = tasks.getTaskStats()
  const successOutput = `${kleur.green(stats.successful.toString() + ' successful')}, ${
    stats.allTasks
  } total`

  const cachedOutput =
    stats.allTasks === stats['success:lazy']
      ? rainbow('>>> MAXIMUM LAZY')
      : `${stats['success:lazy']} cached, ${stats.allTasks} total`

  const output = dedent`
    
          Tasks:     ${successOutput}
         Cached:     ${cachedOutput}`
  logger.log(output)
}
