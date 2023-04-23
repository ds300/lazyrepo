import { exists } from '../exists.js'
import { writeFile } from '../fs.js'
import { logger } from '../logger/logger.js'

export async function init() {
  const configPath = 'lazy.config.mjs'
  if (await exists(configPath)) {
    logger.fail(`Config file already exists at '${configPath}'`)
  }
  await writeFile(
    configPath,
    `// @ts-check

/** @type {import('lazyrepo').LazyConfig} */
export default {}\n`,
  )
  logger.success(`\nCreated config file at '${configPath}'`)
}
