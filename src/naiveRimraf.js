import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'fs'
import path from 'path'

/**
 * @param {string} dir
 */
export const naiveRimraf = (dir) => {
  if (!existsSync(dir)) return
  const files = readdirSync(dir)
  for (const file of files) {
    const fullPath = path.join(dir, file)
    const isDir = statSync(fullPath).isDirectory()
    if (isDir) {
      naiveRimraf(fullPath)
    } else {
      unlinkSync(fullPath)
    }
  }
  rmdirSync(dir)
}
