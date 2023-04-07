import { existsSync, writeFileSync } from 'fs'
import { log } from '../log.js'

export function init() {
  const configPath = 'lazy.config.mjs'
  if (existsSync(configPath)) {
    log.fail(`Config file already exists at '${configPath}'`)
  }
  writeFileSync(
    configPath,
    `// @ts-check

/** @type {import('lazyrepo').LazyConfig} */
export default {}\n`,
  )
  log.success('Created lazy.config.ts')
}
