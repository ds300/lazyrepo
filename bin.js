#!/usr/bin/env node

import { resolve } from 'path'
import { existsSync } from './src/fs.js'

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { exec } = await (existsSync('./node_modules/lazyrepo/src/cli.js')
  ? import(resolve('./node_modules/lazyrepo/src/cli.js'))
  : import('./src/cli.js'))

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
exec(process.argv)
