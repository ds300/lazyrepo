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
    process.exit(0)
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
    process.exit(0)
  })

cli.command('init', 'create config file').action(() => {
  init()
  process.exit(0)
})

cli.command('clean', 'delete all local cache data').action(() => {
  clean()
  process.exit(0)
})

cli
  .command('inherit', 'run command from configuration file specified by script name')
  .action(async () => {
    await inherit()
  })

cli.help()

cli.parse()
