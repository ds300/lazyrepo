import { cac } from 'cac'
import pc from 'picocolors'
import { clean } from './commands/clean.js'
import { inherit } from './commands/inherit.js'
import { init } from './commands/init.js'
import { run } from './commands/run.js'
import { readFileSync } from './fs.js'
import { isTest } from './isTest.js'
import { logger } from './logger/logger.js'
import { rainbow } from './rainbow.js'

const cli = cac('lazy')

cli
  .command('<script>', 'run the script in all packages that support it')
  .option(
    '--filter="<path-glob>"',
    '[string] only run the script in packages that match the given path glob',
  )
  .option('--force', '[boolean] ignore the cache', {
    default: false,
  })
  .action(async (scriptName, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    await run({ scriptName, options })
  })

cli
  .command('run <script>', 'run the script in all packages that support it')
  .option(
    '--filter="<path-glob>"',
    '[string] only run the script in packages that match the given path glob',
  )
  .option('--force', '[boolean] ignore the cache', {
    default: false,
  })
  .action(async (scriptName, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    await run({ scriptName, options })
  })

cli.command('init', 'create config file').action(() => {
  init()
})

cli.command('clean', 'delete all local cache data').action(() => {
  clean()
})

cli
  .command(
    'inherit',
    '(use in package.json "scripts" only) Runs the command specified in the lazy config file for the script name.',
  )
  .option('--force', '[boolean] ignore the cache', { default: false })
  .action(async (options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await inherit(options)
  })

cli.help()

const upperCaseFirst = (/** @type {string} */ str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 *
 * @param {string[]} argv
 */
export async function execCli(argv) {
  /** @type {string} */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const version = isTest
    ? '0.0.0-test'
    : // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  logger.log(pc.bold('lazyrepo'), pc.gray(`${version}`))
  logger.log(rainbow('-'.repeat(`lazyrepo ${version}`.length)))

  try {
    cli.parse(argv, { run: false })
    await cli.runMatchedCommand()
    // the InteractiveLogger runs a setInterval so we need to explicitly call process.exit(0) here to avoid hanging
    process.exit(0)
  } catch (/** @type {any} */ e) {
    // find out if this is a CACError instance
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (e.name === 'CACError') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      const msg = upperCaseFirst(e.message)
      // eslint-disable-next-line no-console
      console.log(pc.red(msg) + '\n')
      cli.outputHelp()
      process.exit(1)
    } else {
      throw e
    }
  }
}
