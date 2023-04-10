import { existsSync, mkdirSync, statSync } from 'fs'
import kleur from 'kleur'
import path, { join } from 'path'
import { taskKey } from '../TaskGraph.js'
import { getDiffPath, getManifestPath, getTask as getTaskConfig } from '../config.js'
import { timeSince } from '../log.js'
import { workspaceRoot } from '../workspaceRoot.js'
import { ManifestConstructor } from './ManifestConstructor.js'
import { getInputFiles } from './getInputFiles.js'
import { hashFile, hashString } from './hash.js'

const types = {
  upstreamTaskInputs: 'upstream task inputs',
  dependencyTaskInputs: 'dependency task inputs',
  envVar: 'env var',
  file: 'file',
}

const order = [types.upstreamTaskInputs, types.dependencyTaskInputs, types.envVar, types.file]

/**
 *
 * @param {string} a
 * @param {string} b
 * @returns
 */
export const compareManifestTypes = (a, b) => {
  const aIndex = order.indexOf(a)
  const bIndex = order.indexOf(b)
  if (aIndex === bIndex) {
    return 0
  }
  return aIndex < bIndex ? -1 : 1
}

/**
 * @param {{ task: import('../types.js').ScheduledTask, tasks: import('../TaskGraph.js').TaskGraph }} param0
 * @returns
 */
export async function computeManifest({ tasks, task }) {
  const taskConfig = await getTaskConfig({ taskName: task.taskName })

  if (taskConfig.cache === 'none') return null

  const manifestPath = getManifestPath(task)
  const diffPath = getDiffPath(task)

  if (!existsSync(path.dirname(manifestPath))) {
    mkdirSync(path.dirname(manifestPath), { recursive: true })
  }
  if (diffPath && !existsSync(path.dirname(diffPath))) {
    mkdirSync(path.dirname(diffPath), { recursive: true })
  }

  const manifestConstructor = new ManifestConstructor({ diffPath, manifestPath })

  const extraFiles = []

  for (const [otherTaskName, depConfig] of Object.entries(taskConfig.runsAfter ?? {})) {
    if (!depConfig.inheritsInput && depConfig.usesOutput === false) continue
    const isTopLevel = (await getTaskConfig({ taskName: otherTaskName })).topLevel

    const key = taskKey(isTopLevel ? workspaceRoot : task.taskDir, otherTaskName)
    const depTask = tasks.allTasks[key]
    if (isTopLevel && !depTask) throw new Error(`Missing task: ${key}.`)
    if (!depTask) continue

    if (depConfig.inheritsInput) {
      if (!depTask.inputManifestCacheKey) {
        throw new Error(`Missing inputManifestCacheKey for task: ${key}.`)
      }

      manifestConstructor.update('upstream task inputs', key, depTask.inputManifestCacheKey)
    }
    if (depConfig.usesOutput !== false) {
      extraFiles.push(depTask.outputFiles)
    }
  }

  if (
    taskConfig.independent !== true &&
    (taskConfig.cache?.inheritsInputFromDependencies ?? true)
  ) {
    // TODO: test that localDeps is always sorted
    for (const packageName of task.packageDetails?.localDeps ?? []) {
      const depPackage = tasks.repoDetails.packagesByName[packageName]
      const key = taskKey(depPackage.dir, task.taskName)
      const depTask = tasks.allTasks[key]
      if (!depTask) continue
      if (!depTask.inputManifestCacheKey) {
        throw new Error(`Missing inputManifestCacheKey for task: ${key}.`)
      }

      manifestConstructor.update('upstream package inputs', key, depTask.inputManifestCacheKey)
    }
  }

  for (const envVar of taskConfig.cache?.inputEnvVars?.sort() ?? []) {
    const hash = hashString(process.env[envVar] ?? '')
    manifestConstructor.update('env var', envVar, hash)
  }

  let numSkipped = 0
  let numHashed = 0
  // getInputFiles returns null for cache=none
  // TODO: make it clearer that's what's happening. Result type or something
  const files = await getInputFiles(task, extraFiles.flat())
  if (!files) return null

  const start = Date.now()

  for (const file of files.sort()) {
    const fullPath = join(workspaceRoot, file)
    const stat = statSync(fullPath)
    const timestamp = String(stat.mtimeMs)

    if (manifestConstructor.copyLineOverIfMetaIsSame('file', file, timestamp)) {
      numSkipped++
      continue
    }

    numHashed++
    const hash = hashFile(fullPath, stat.size)
    manifestConstructor.update('file', file, hash, timestamp)
  }

  const { didChange, hash } = await manifestConstructor.end()

  // todo: always log this if verbose
  if (Date.now() - start > 100) {
    console.log(
      task.terminalPrefix,
      kleur.gray(
        `Hashed ${numHashed}/${numSkipped + numHashed} files in ${kleur.cyan(timeSince(start))}`,
      ),
    )
  }

  task.inputManifestCacheKey = hash

  return didChange
}
