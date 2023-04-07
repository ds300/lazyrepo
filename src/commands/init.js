import { writeFileSync } from 'fs'
import { log } from '../log.js'

export function init() {
  writeFileSync(
    'lazy.config.mjs',
    `// @ts-check

    /** @type {import('lazyrepo').LazyConfig} */
    export default {}\n`,
  )
  log.success('Created lazy.config.ts')
}
