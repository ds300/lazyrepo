#!/usr/bin/env node

import { existsSync } from 'fs'

if (existsSync('./node_modules/lazyrepo/src/cli.js')) {
  // @ts-ignore
  await import('./node_modules/lazyrepo/src/cli.js')
} else {
  await import('./src/cli.js')
}
