import glob from 'fast-glob'
import k from 'kleur'
import { help } from './commands/help.js'
import { inherit } from './commands/inherit.js'
import { init } from './commands/init.js'
import { run } from './commands/run.js'
import { timeSince } from './logger/formatting.js'
import { logger } from './logger/logger.js'
import { rimraf } from './rimraf.js'
import { workspaceRoot } from './workspaceRoot.js'

/**
 * @param {string[]} args
 */
async function cli(args) {
  let [command] = args
  if (!command) {
    help(true)
    process.exit(1)
  }

  if (command === ':init') {
    init()
    process.exit(0)
  }

  if (command === ':help' || command === '-h' || command === '--help') {
    help()
    process.exit(0)
  }

  if (command === ':clean') {
    const cacheDirs = glob.sync(['**/*/.lazy', '.lazy'], {
      ignore: ['**/node_modules/**'],
      absolute: true,
      onlyDirectories: true,
      cwd: workspaceRoot,
    })

    logger.log(`Cleaning ${cacheDirs.length} cache directories...`)
    cacheDirs.forEach(rimraf)
    return
  }

  await run(args)
}

async function main() {
  if (process.argv[2] === ':inherit') {
    await inherit()
    return
  }
  logger.log(k.green('\n::'), k.bold().bgGreen(' lazyrepo '), k.green('::\n'))
  const start = Date.now()
  await cli(process.argv.slice(2))
  logger.success(`Done in ${timeSince(start)}`)
  process.exit(0)
}

main()
