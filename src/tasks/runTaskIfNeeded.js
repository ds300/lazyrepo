import pc from 'picocolors'
import stripAnsi from 'strip-ansi'
import { cwd } from '../cwd.js'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from '../fs.js'
import { logger } from '../logger/logger.js'
import { computeManifest } from '../manifest/computeManifest.js'
import { cacheOutputs } from '../outputs/cacheOutputs.js'
import { restoreOutputs } from '../outputs/restoreOutputs.js'
import { dirname, relative } from '../path.js'
import { isCi } from '../utils/isCi.js'
import { runTask } from './runTask.js'

/**
 * @param {import('../types.js').ScheduledTask} task
 * @param {import('./TaskGraph.js').TaskGraph} tasks
 * @returns {Promise<{didRunTask: boolean, didSucceed: boolean}>}
 */
export async function runTaskIfNeeded(task, tasks) {
  task.logger.restartTimer()

  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)

  const previousManifestPath = taskConfig.getManifestPath()
  const nextManifestPath = taskConfig.getNextManifestPath()

  const didHaveManifest = existsSync(previousManifestPath)

  const manifestResult = await computeManifest({
    task,
    tasks,
  })

  let didRunTask = false
  let didSucceed = false

  if (task.force) {
    task.logger.log('cache miss, --force flag used')

    didSucceed = (await runTask(task, tasks)).didSucceed
    didRunTask = true
  } else if (manifestResult === null) {
    task.logger.log('cache disabled')
    didSucceed = (await runTask(task, tasks)).didSucceed
    didRunTask = true
  } else if (manifestResult.didChange) {
    const diffPath = taskConfig.getDiffPath()
    const diff = existsSync(diffPath) ? readFileSync(diffPath, 'utf-8').toString() : null
    if (diff?.length) {
      if (isCi) {
        task.logger.note('cache miss')
        task.logger.group('changes since last run', diff)
      } else {
        const allLines = diff.split('\n')
        const diffPath = taskConfig.getDiffPath()
        mkdirSync(dirname(diffPath), { recursive: true })
        writeFileSync(diffPath, stripAnsi(allLines.join('\n')))
        task.logger.note('cache miss, changes since last run:')
        allLines.slice(0, 10).forEach((line) => task.logger.diff(line))
        if (allLines.length > 10) {
          task.logger.note(`... and ${allLines.length - 10} more. See ${diffPath} for full diff.`)
        }
      }
    } else if (!didHaveManifest) {
      task.logger.log('cache miss, no previous manifest found')
    }
    didSucceed = (await runTask(task, tasks)).didSucceed
    didRunTask = true
  } else {
    // cache hit
  }

  if (!didRunTask || didSucceed) {
    task.logger.note('input manifest: ' + relative(cwd, previousManifestPath))
    if (isCi && tasks.config.logManifestsOnCi) {
      task.logger.group(
        'input manifest',
        readFileSync(
          manifestResult?.didWriteManifest ? nextManifestPath : previousManifestPath,
        ).toString(),
      )
    }
  }

  if (didRunTask) {
    if (didSucceed) {
      if (manifestResult?.didWriteManifest) {
        renameSync(nextManifestPath, previousManifestPath)
      }
      if (taskConfig.logMode === 'errors-only' || taskConfig.logMode === 'none') {
        task.logger.log('output log: ' + relative(cwd, taskConfig.getLogPath()))
      }
      await cacheOutputs(tasks, task)
      task.logger.success('done')
    } else {
      if (existsSync(previousManifestPath)) {
        unlinkSync(previousManifestPath)
      }
      if (taskConfig.logMode === 'none') {
        task.logger.log('output log: ' + relative(cwd, taskConfig.getLogPath()))
      } else {
        task.logger.log(pc.bgRed(pc.bold(' ERROR OUTPUT ')))
        // log from root to avoid prefix
        // TODO: handle missing log file
        logger.log(readFileSync(taskConfig.getAnsiLogPath()).toString())
      }
      task.logger.fail('failed')
    }
  } else {
    if (taskConfig.logMode !== 'full') {
      task.logger.log('output log: ' + relative(cwd, taskConfig.getLogPath()))
    } else {
      task.logger.log(pc.bgCyan(pc.bold(' CACHED OUTPUT ')))
      // log from root to avoid prefix
      // TODO: handle missing log file
      logger.log(readFileSync(taskConfig.getAnsiLogPath()).toString())
    }
    restoreOutputs(tasks, task)
    task.logger.success(`cache hit ⚡️`)
  }

  return { didRunTask, didSucceed: !didRunTask || didSucceed }
}
