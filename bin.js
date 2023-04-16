#!/usr/bin/env node

import { resolve } from 'path'
import { existsSync } from './src/fs.js'

if (existsSync('./node_modules/lazyrepo/src/index.js')) {
  await import(resolve('./node_modules/lazyrepo/src/index.js'))
} else {
  await import('./src/index.js')
}
