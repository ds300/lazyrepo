import slash from 'slash'
import { dirname } from './path.js'

/** @param {string} dir */
export const getRootDir = (dir) => {
  let parentDir = dirname(dir)
  while (parentDir !== dir) {
    dir = parentDir
    parentDir = dirname(dir)
  }
  return parentDir
}

// eslint-disable-next-line no-restricted-properties
export const cwd = slash(process.cwd())
export const rootDir = getRootDir(cwd)
