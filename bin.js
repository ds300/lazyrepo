#!/usr/bin/env node

import { existsSync } from './src/fs.js'
import { resolve } from './src/path.js'

if (existsSync('./node_modules/lazyrepo/src/cli.js')) {
  await import(resolve('./node_modules/lazyrepo/src/cli.js'))
} else {
  await import('./src/cli.js')
}
