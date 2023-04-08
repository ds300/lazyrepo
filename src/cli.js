import kleur from 'kleur'
import { help } from './commands/help.js'
import { inherit } from './commands/inherit.js'
import { init } from './commands/init.js'
import { run } from './commands/run.js'
import { log } from './log.js'

/**
 * @param {string[]} args
 */
async function cli(args) {
  let [command, taskName] = args
  if (!command) {
    help(true)
    process.exit(1)
  }

  if (command === 'init') {
    init()
    process.exit(0)
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

  await run([taskName])
}

async function main() {
  if (process.argv[2] === ':inherit') {
    await inherit()
    return
  }
  const done = log.timedTask(kleur.bold().bgGreen(' lazyrepo '))
  await cli(process.argv.slice(2))
  done('Done')
}

main()
