import { getConfig } from '../config.js'
import { log } from '../log.js'
import { rainbow } from '../rainbow.js'
import { TaskGraph } from '../TaskGraph.js'
import { getRepoDetails } from '../workspace.js'
import { workspaceRoot } from '../workspaceRoot.js'

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
 *
 * @param {string[]} array
 * @param {(s: string) => boolean} predicate
 * @returns {string[][]}
 */
function partitionBy(array, predicate) {
  const result = []
  /** @type {string[] | null} */
  let current = null
  /** @type {boolean | null} */
  let currentFlag = null
  for (const item of array) {
    const flag = predicate(item)
    if (current === null) {
      current = [item]
      currentFlag = flag
    } else if (flag !== currentFlag) {
      result.push(current)
      current = [item]
      currentFlag = flag
    } else {
      current.push(item)
    }
  }
  if (current !== null) {
    result.push(current)
  }
  return result
}

/**
 * @param {string[]} args
 */
export function parseRunArgs(args) {
  /**
   * @type {import('../types.js').CLITaskDescription[]}
   */
  const taskDescriptors = []

  if (args[0] === ':run' || args[0] === ':force') {
    const sections = partitionBy(args, (arg) => arg === ':run' || arg === ':force')
    for (let i = 0; i < sections.length; i += 2) {
      const [type] = sections[i]
      const [taskName, ...rest] = sections[i + 1]
      const [filterPaths, extraArgs] = splitArray(rest, '--')
      taskDescriptors.push({
        taskName,
        extraArgs: extraArgs ?? [],
        filterPaths,
        force: type === ':force',
      })
    }
  } else {
    taskDescriptors.push({
      taskName: args[0],
      extraArgs: args.slice(1),
      filterPaths: process.cwd() === workspaceRoot ? [] : [process.cwd()],
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

  if (Object.entries(tasks.allTasks).every(([, task]) => task.status === 'success:lazy')) {
    console.log('\n' + rainbow('>>> MAXIMUM LAZY'))
  }
}
