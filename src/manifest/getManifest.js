import crypto from 'crypto'
import { statSync } from 'fs'
import kleur from 'kleur'
import { TaskGraph, taskKey } from '../TaskGraph.js'
import { getTask as getTaskConfig } from '../config.js'
import { timeSince } from '../log.js'
import { getInputFiles } from './getInputFiles.js'
import { hashFile, hashString } from './hash.js'

/**
 * @param {{ task: import('../types.js').ScheduledTask, tasks: TaskGraph, prevManifest?: Record<string, [hash: string, lastModified: number]> }} param0
 * @returns
 */
export async function getManifest({ tasks, task, prevManifest }) {
  /**
   * @type {string[]}
   */
  const result = []

  const sumHash = crypto.createHash('sha256')

  const taskConfig = await getTaskConfig({ taskName: task.taskName })

  if (taskConfig.cache === 'none') return null

  if (taskConfig.cache?.inheritsInputFromDependencies ?? true) {
    // TODO: test that localDeps is always sorted
    for (const packageName of task.packageDetails?.localDeps ?? []) {
      const depPackage = tasks.repoDetails.packagesByName[packageName]
      const key = taskKey(depPackage.dir, task.taskName)
      const depTask = tasks.allTasks[key]
      if (!depTask) continue
      if (!depTask.inputManifestCacheKey) {
        throw new Error(`Missing inputManifestCacheKey for task: ${key}.`)
      }

      sumHash.update(depTask.inputManifestCacheKey)
      result.push(`task inputs for ${key} \t${depTask.inputManifestCacheKey}`)
    }
  }

  for (const envVar of taskConfig.cache?.inputEnvVars?.sort() ?? []) {
    const hash = hashString(process.env[envVar] ?? '')
    sumHash.update(hash)
    result.push(`env ${envVar} \t${hash}`)
  }

  let numSkipped = 0
  let numHashed = 0
  const files = await getInputFiles(task)
  if (!files) return null

  const start = Date.now()

  files?.sort()
  for (const file of files) {
    const prev = prevManifest?.[file]
    const stat = statSync(file)
    if (prev && prev[1] === stat.mtime.getTime()) {
      sumHash.update(prev[0])
      result.push(`file ${file}\t${prev[0]}\t${prev[1]}`)
      numSkipped++
      continue
    }

    numHashed++
    const hash = hashFile(file, stat.size)
    sumHash.update(hash)
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

  task.inputManifestCacheKey = sumHash.digest('hex')

  return result
}
