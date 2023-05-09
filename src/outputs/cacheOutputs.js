import { cwd } from '../cwd.js'
import { mkdirSync, statSync } from '../fs.js'
import { logger } from '../logger/logger.js'
import { createLazyWriteStream } from '../manifest/createLazyWriteStream.js'
import { getOutputFiles } from '../manifest/getInputFiles.js'
import { dirname, join, relative } from '../path.js'
import { rimraf } from '../utils/rimraf.js'
import { copyFileWithMtime } from './copyFileWithMtime.js'

/**
 * @param {import("../tasks/TaskGraph.js").TaskGraph} tasks
 * @param {import("../types.js").ScheduledTask} task
 */
export async function cacheOutputs(tasks, task) {
  const outputFiles = getOutputFiles(tasks, task)
  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)
  const outDir = taskConfig.getOutputPath()
  const outManifestPath = taskConfig.getOutputManifestPath()
  rimraf(outDir)
  rimraf(outManifestPath)

  if (!outputFiles || taskConfig.cache === 'none') {
    task.outputFiles = []
  } else if (outputFiles.length === 0) {
    task.outputFiles = []
    // TODO: should this be a failure? with a config option to allow it to pass?
    task.logger.warn(`no output files found`)
  } else {
    task.outputFiles = outputFiles
  }

  mkdirSync(outDir, { recursive: true })

  const rootWorkspaceDir = tasks.config.project.root.dir

  const manifest = createLazyWriteStream(outManifestPath)
  let numFiles = 0

  for (const file of outputFiles ?? []) {
    if (file.startsWith('..')) {
      throw logger.fail('output file is outside of workspace: ' + file)
    }
    numFiles++
    const absoluteFile = join(rootWorkspaceDir, file)
    const dest = join(outDir, file)
    mkdirSync(dirname(dest), { recursive: true })
    const stat = statSync(absoluteFile)
    copyFileWithMtime(absoluteFile, dest, stat.mtime)
    const timestamp = String(Math.round(stat.mtime.getTime()))

    manifest.write(file + '\t' + timestamp + '\n')
  }

  await manifest.close()
  if (numFiles) {
    task.logger.log('output manifest:', relative(cwd, outManifestPath))
  }
}
