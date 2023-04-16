import { existsSync, writeFileSync } from '../fs.js'
import { logger } from '../logger/logger.js'

export function init() {
  const configPath = 'lazy.config.mjs'
  if (existsSync(configPath)) {
    logger.fail(`Config file already exists at '${configPath}'`)
  }
  writeFileSync(
    configPath,
    `// @ts-check

/** @type {import('lazyrepo').LazyConfig} */
export default {}\n`,
  )
  logger.success(`\nCreated config file at '${configPath}'`)
}
