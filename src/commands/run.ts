import { getConfig } from '../config'
import { log } from '../log'
import { rainbow } from '../rainbow'
import { TaskGraph } from '../TaskGraph'
import { getRepoDetails } from '../workspace'

export async function run(taskNames: string[]) {
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
    console.log(rainbow('>>> FULL LAZY'))
  }
}
