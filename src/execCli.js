import { cac } from 'cac'
import pc from 'picocolors'
import { clean } from './commands/clean.js'
import { inherit } from './commands/inherit.js'
import { init } from './commands/init.js'
import { run } from './commands/run.js'
import { readFileSync } from './fs.js'
import { LazyError } from './logger/LazyError.js'
import { logger } from './logger/logger.js'
import { rainbow } from './logger/rainbow.js'
import { isTest } from './utils/isTest.js'

const cli = cac('lazy')

cli
  .command('<script>', 'run the script in all packages that support it')
  .option(
    '--filter <path-glob>',
    '[string] only run the script in packages that match the given path glob',
  )
  .option('--force', '[boolean] ignore the cache', {
    default: false,
  })
  .option('--verbose', '[boolean] verbose log output', {
    default: false,
  })
  .action(async (scriptName, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return await run({ scriptName, options })
  })

cli
  .command('run <script>', 'run the script in all packages that support it')
  .option(
    '--filter <path-glob>',
    '[string] only run the script in packages that match the given path glob',
  )
  .option('--force', '[boolean] ignore the cache', {
    default: false,
  })
  .option('--verbose', '[boolean] verbose log output', {
    default: false,
  })
  .action(async (scriptName, options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return await run({ scriptName, options })
  })

cli.command('init', 'create config file').action(() => {
  return init()
})

cli.command('clean', 'delete all local cache data').action(() => {
  return clean()
})

cli
  .command(
    'inherit',
    '(use in package.json "scripts" only) Runs the command specified in the lazy config file for the script name.',
  )
  .option('--force', '[boolean] ignore the cache', { default: false })
  .option('--verbose', '[boolean] verbose log output', {
    default: false,
  })
  .action(async (options) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return await inherit(options)
  })

cli.help()

const upperCaseFirst = (/** @type {string} */ str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const exitCode = (await cli.runMatchedCommand()) ?? 0
    if (typeof exitCode === 'number') return exitCode
    return 0
  } catch (/** @type {any} */ e) {
    // find out if this is a CACError instance
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (e.name === 'CACError') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      const msg = upperCaseFirst(e.message)
      // eslint-disable-next-line no-console
      console.log(pc.red(msg) + '\n')
      cli.outputHelp()
    } else if (e instanceof LazyError) {
      logger.log(e.format())
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      logger.log(e.stack ?? e.message ?? e)
    }
    return 1
  } finally {
    logger.stop()
  }
}
