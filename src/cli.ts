import { writeFileSync } from 'fs'
import kleur from 'kleur'
import { help } from './commands/help'
import { run } from './commands/run'
import { log } from './log'

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

  await run([taskName])
}

async function main() {
  const done = log.timedTask(kleur.bold().bgGreen(' lazyrepo '))
  await cli(process.argv.slice(2))
  done('Done')
}

main()
