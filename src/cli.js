import { cac } from 'cac'
import { clean } from './commands/clean.js'
import { inherit } from './commands/inherit.js'
import { init } from './commands/init.js'
import { run } from './commands/run.js'

const cli = cac('lazyrepo')

cli
  .command('<task>', 'run task in all packages')
  .option('--filter <paths>', '[string] run task in packages specified by paths')
  .option('--force', '[boolean] ignore existing cached artifacts', {
    default: false,
  })
  .action(async (task, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await run(task, options)
  })

cli
  .command('run <task>', 'run task in all packages')
  .option('--filter <paths>', '[string] run task in packages specified by paths')
  .option('--force', '[boolean] ignore existing cached artifacts', {
    default: false,
  })
  .action(async (task, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await run(task, options)
  })

cli.command('init', 'create config file').action(() => {
  init()
})

cli.command('clean', 'delete all local cache data').action(() => {
  clean()
})

cli
  .command('inherit', 'run command from configuration file specified by script name')
  .action(async () => {
    await inherit()
  })

cli.help()

/**
 *
 * @param {string[]} argv
 */
export async function exec(argv) {
  try {
    cli.parse(argv, { run: false })
    await cli.runMatchedCommand()
  } catch (/** @type {any} */ e) {
    // find out if this is a CACError instance
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (e.name === 'CACError') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, no-console
      console.error(e.message)
      // eslint-disable-next-line no-console
      cli.outputHelp()
      process.exit(1)
    } else {
      throw e
    }
  }
}
