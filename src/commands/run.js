import { getConfig } from '../config.js'
import { log } from '../log.js'
import { rainbow } from '../rainbow.js'
import { TaskGraph } from '../TaskGraph.js'
import { getRepoDetails } from '../workspace.js'

/**
 * @param {string[]} taskNames
 */
export async function run(taskNames) {
  const tasks = new TaskGraph({
    config: await getConfig(),
    endTasks: taskNames,
    repoDetails: getRepoDetails(),
  })

  if (tasks.sortedTaskKeys.length === 0) {
    log.fail(`No tasks found matching [${taskNames.join(', ')}]`)
  }

  await tasks.runAllTasks()

  if (Object.entries(tasks.allTasks).every(([_, task]) => task.status === 'success:lazy')) {
    console.log('\n' + rainbow('>>> MAXIMUM LAZY'))
  }
}
