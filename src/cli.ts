import { writeFileSync } from 'fs'
import kleur from 'kleur'
import { TaskGraph } from './TaskGraph'
import { help } from './commands/help'
import { getConfig } from './config'
import { log } from './log'
import { rainbow } from './rainbow'
import { getRepoDetails } from './workspace'

async function cli(args: string[]) {
  let [command, taskName] = args
  if (!command) {
    help(true)
    process.exit(1)
  }

  if (command === 'init') {
    writeFileSync(
      'lazy.config.ts',
      `import { LazyConfig } from 'lazyrepo'\n\nexport default {} satisfies LazyConfig`,
    )
    log.success('Created lazy.config.ts')
    process.exit(1)
  }

  if (command === 'help') {
    help()
    process.exit(0)
  }

  if (command === 'run' && !taskName) {
    help(true)
    process.exit(1)
  }

  if (!taskName) {
    taskName = command
  }

  const tasks = new TaskGraph({
    config: await getConfig(),
    endTasks: [taskName],
    repoDetails: getRepoDetails(),
  })

  if (tasks.sortedTaskKeys.length === 0) {
    log.fail(`No tasks found called '${taskName}'`)
  }

  await tasks.runAllTasks()

  if (Object.entries(tasks.allTasks).every(([_, task]) => task.status === 'success:lazy')) {
    console.log(rainbow('>>> FULL LAZY'))
  }
}

async function main() {
  const done = log.timedTask(kleur.bold().bgGreen(' lazyrepo '))
  await cli(process.argv.slice(2))
  done('Done')
}

main()
