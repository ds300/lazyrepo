import { getConfig } from '../config.js'
import { log } from '../log.js'
import { rainbow } from '../rainbow.js'
import { TaskGraph } from '../TaskGraph.js'
import { getRepoDetails } from '../workspace.js'

/**
 * @param {string[]} args
 */
export function parseRunArgs(args) {
  /**
   * @type {import('../types.js').CLITaskDescription[]}
   */
  const taskDescriptors = []

  if (args[0] === ':run') {
    let i = 0
    while (i < args.length) {
      const arg = args[i]
      if (arg === ':run') {
        i++
        const taskName = args[i]
        i++
        const filterPaths = []
        const extraArgs = []
        while (i < args.length && args[i] !== ':run' && args[i] !== '--') {
          filterPaths.push(args[i])
          i++
        }
        if (args[i] === '--') {
          i++
          while (i < args.length && args[i] !== ':run') {
            extraArgs.push(args[i])
            i++
          }
        }
        taskDescriptors.push({
          taskName,
          extraArgs,
          filterPaths,
        })
      } else {
        log.fail(`Unexpected argument '${arg}'`)
      }
    }
  } else {
    taskDescriptors.push({ taskName: args[0], extraArgs: args.slice(1), filterPaths: [] })
  }

  return taskDescriptors
}

/**
 * @param {string[]} args
 */
export async function run(args) {
  const taskDescriptors = parseRunArgs(args)
  const tasks = new TaskGraph({
    config: await getConfig(),
    taskDescriptors,
    repoDetails: getRepoDetails(),
  })

  if (tasks.sortedTaskKeys.length === 0) {
    log.fail(`No tasks found matching [${taskDescriptors.map((t) => t.taskName).join(', ')}]`)
  }

  await tasks.runAllTasks()

  if (Object.entries(tasks.allTasks).every(([_, task]) => task.status === 'success:lazy')) {
    console.log('\n' + rainbow('>>> MAXIMUM LAZY'))
  }
}
