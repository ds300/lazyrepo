import { statSync } from 'fs'
import { getTask } from '../config.js'
import { log } from '../log.js'
import { getInputFiles } from './getInputFiles.js'
import { hashFile, hashString } from './hash.js'

/**
 *
 * @param {{ taskName: string, cwd: string, prevManifest?: Record<string, [hash: string, lastModified: number]> }} param0
 * @returns
 */
export async function getManifest({ taskName, cwd, prevManifest }) {
  /**
   * @type {string[]}
   */
  const result = []

  const task = await getTask({ taskName })

  if (task.cache === 'none') return null

  for (const envVar of task.cache?.env ?? []) {
    result.push(`env ${envVar} \t${hashString(process.env[envVar] ?? '')}`)
  }

  let numSkipped = 0
  let numHashed = 0
  const files = await getInputFiles({ taskName, cwd })
  if (!files) return null
  for (const file of files) {
    const prev = prevManifest?.[file]
    const stat = statSync(file)
    if (prev && prev[1] === stat.mtime.getTime()) {
      result.push(`file ${file}\t${prev[0]}\t${prev[1]}`)
      numSkipped++
      continue
    }

    numHashed++
    const hash = hashFile(file, stat.size)
    result.push(`file ${file}\t${hash}\t${stat.mtime.getTime()}`)
  }

  log.substep(`Hashed ${numHashed}/${numSkipped + numHashed} files`)

  result.sort()
  return result
}
