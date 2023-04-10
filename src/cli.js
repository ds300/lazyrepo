import glob from 'fast-glob'
import kleur from 'kleur'
import { help } from './commands/help.js'
import { inherit } from './commands/inherit.js'
import { init } from './commands/init.js'
import { run } from './commands/run.js'
import { log } from './log.js'
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

    console.log(`Cleaning ${cacheDirs.length} cache directories...`)
    cacheDirs.forEach(rimraf)
    console.log('Done')
    return
  }

  await run(args)
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
