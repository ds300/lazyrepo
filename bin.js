#!/usr/bin/env node

import { existsSync } from 'fs'
import { resolve } from 'path'

if (existsSync('./node_modules/lazyrepo/src/cli.js')) {
  await import(resolve('./node_modules/lazyrepo/src/cli.js'))
} else {
  await import('./src/cli.js')
}
