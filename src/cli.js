import glob from 'fast-glob'
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'fs'
import kleur from 'kleur'
import path from 'path'
import { help } from './commands/help.js'
import { inherit } from './commands/inherit.js'
import { init } from './commands/init.js'
import { run } from './commands/run.js'
import { VERSION } from './constants.js'
import { log } from './log.js'
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
    const cacheDirs = glob.sync('**/*/.lazy', {
      ignore: ['**/node_modules/**'],
      absolute: true,
      onlyDirectories: true,
      cwd: workspaceRoot,
    })

    /**
     * @param {string} dir
     */
    const rimraf = (dir) => {
      if (!existsSync(dir)) return
      const files = readdirSync(dir)
      for (const file of files) {
        const fullPath = path.join(dir, file)
        const isDir = statSync(fullPath).isDirectory()
        if (isDir) {
          rimraf(fullPath)
        } else {
          unlinkSync(fullPath)
        }
      }
      rmdirSync(dir)
    }

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
  const done = log.timedTask(kleur.bold().bgGreen(` lazyrepo v${VERSION}`))
  await cli(process.argv.slice(2))
  done('Done')
}

main()
