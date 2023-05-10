#!/usr/bin/env node

import { pathToFileURL } from 'url'
import { existsSync } from './src/fs.js'
import { resolve } from './src/path.js'

if (existsSync('./node_modules/lazyrepo/src/cli.js')) {
  await import(pathToFileURL(resolve('./node_modules/lazyrepo/src/cli.js')).toString())
} else {
  await import('./src/cli.js')
}
