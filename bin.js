#!/usr/bin/env node

let path = './src/cli.js'
if (import.meta.resolve) {
  try {
    path = await import.meta.resolve?.('lazyrepo/src/cli.js')
  } catch (e) {
    // ignore
  }
}

await import(path)
