import pc from 'picocolors'
import { dedent } from 'ts-dedent'
import { Config } from '../config/config.js'
import { InteractiveLogger } from '../logger/InteractiveLogger.js'
import { getColorForString, pipe } from '../logger/formatting.js'
import { logger } from '../logger/logger.js'
import { rainbow } from '../logger/rainbow.js'
import { TaskGraph } from '../tasks/TaskGraph.js'
import { createTimer } from '../utils/createTimer.js'

/**
 * @param {{scriptName: string, options: import('../types.js').CLIOption}} args
 * @param {import('../config/config.js').Config} [_config]
 */
export async function run({ scriptName, options }, _config) {
  const timer = createTimer()
  const config = _config ?? (await Config.fromCwd(process.cwd(), options.verbose))

  const filterPaths = options.filter
    ? Array.isArray(options.filter)
      ? options.filter
      : [options.filter]
    : // match the directory or any of its descendants
      [process.cwd() + `{,**/*}`]

  /** @type {import('../types.js').RequestedTask[]} */
  const requestedTasks = [
    {
      scriptName,
      filterPaths,
      force: options.force,
      extraArgs: options['--'] ?? [],
    },
  ]

  const tasks = new TaskGraph({
    config,
    requestedTasks,
  })

  if (tasks.sortedTaskKeys.length === 0) {
    logger.fail(
      `No tasks found matching [${requestedTasks.map((t) => t.scriptName).join(', ')}] in ${
        config.project.root.dir
      }`,
    )
  }

  await tasks.runAllTasks()
  if (logger instanceof InteractiveLogger) logger.clearTasks()

  const failedTasks = tasks.allFailedTaskKeys()
  if (failedTasks.length > 0) {
    logger.log(
      pc.bold(pc.red('\nFailed tasks:')),
      failedTasks.map((t) => getColorForString(t).fg(t)).join(', '),
    )
  }

  const stats = tasks.getTaskStats()
  const successColor = stats.successful === 0 ? pc.reset : pipe(pc.green, pc.bold)
  const successOutput = successColor(stats.successful.toString() + ' successful')
  const failureOutput =
    stats.failure > 0 ? ', ' + pc.bold(pc.red(stats.failure.toString() + ' failed')) : ''

  const allLazy = stats.allTasks === stats['success:lazy']

  const cachedOutput =
    pc.bold(`${stats['success:lazy']}/${stats.allTasks} `) +
    (allLazy ? rainbow('>>> MAXIMUM LAZY') : 'cached')

  const output = dedent`
    
         Tasks:  ${successOutput}${failureOutput}, ${stats.allTasks} total
        Cached:  ${cachedOutput}
          Time:  ${timer.formatElapsedTime()}
    
  `
  logger.log(output)
  return failedTasks.length > 0 ? 1 : 0
}
