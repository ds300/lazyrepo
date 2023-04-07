import { statSync } from 'fs'
import kleur from 'kleur'
import { getTask as getTaskConfig } from '../config.js'
import { log, timeSince } from '../log.js'
import { getInputFiles } from './getInputFiles.js'
import { hashFile, hashString } from './hash.js'

/**
 * @param {{ task: import('../types.js').ScheduledTask, prevManifest?: Record<string, [hash: string, lastModified: number]> }} param0
 * @returns
 */
export async function getManifest({ task, prevManifest }) {
  /**
   * @type {string[]}
   */
  const result = []

  const taskConfig = await getTaskConfig({ taskName: task.taskName })

  if (taskConfig.cache === 'none') return null

  for (const envVar of taskConfig.cache?.env ?? []) {
    result.push(`env ${envVar} \t${hashString(process.env[envVar] ?? '')}`)
  }

  let numSkipped = 0
  let numHashed = 0
  const files = await getInputFiles(task)
  const start = Date.now()
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

  // todo: always log this if verbose
  if (Date.now() - start > 100) {
    console.log(
      task.terminalPrefix,
      kleur.gray(
        `Hashed ${numHashed}/${numSkipped + numHashed} files in ${kleur.cyan(timeSince(start))}`,
      ),
    )
  }

  result.sort()
  return result
}
