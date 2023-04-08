import { getConfig } from '../config.js'
import { log } from '../log.js'
import { rainbow } from '../rainbow.js'
import { TaskGraph } from '../TaskGraph.js'
import { getRepoDetails } from '../workspace.js'

/**
 *
 * @param {string[]} array
 * @param {string} item
 * @returns {string[][]}
 */
function splitArray(array, item) {
  const index = array.indexOf(item)
  if (index === -1) {
    return [array]
  }
  return [array.slice(0, index)].concat(splitArray(array.slice(index + 1), item))
}

/**
 * @param {string[]} args
 */
export function parseRunArgs(args) {
  /**
   * @type {import('../types.js').CLITaskDescription[]}
   */
  const taskDescriptors = []

  if (args[0] === ':run') {
    const sections = splitArray(args.slice(1), ':run')
    for (const section of sections) {
      const force = section.includes('--force')
      const [taskName, ...rest] = section.filter((arg) => arg !== '--force')
      const [filterPaths, extraArgs] = splitArray(rest, '--')
      taskDescriptors.push({
        taskName,
        extraArgs: extraArgs ?? [],
        filterPaths,
        force,
      })
    }
  } else {
    taskDescriptors.push({
      taskName: args[0],
      extraArgs: args.slice(1),
      filterPaths: [],
      force: false,
    })
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
