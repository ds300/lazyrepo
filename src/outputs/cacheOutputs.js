import { dirname, join } from 'path'
import { mkdirSync, statSync } from '../fs.js'
import { logger } from '../logger/logger.js'
import { createLazyWriteStream } from '../manifest/createLazyWriteStream.js'
import { getOutputFiles } from '../manifest/getInputFiles.js'
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
  const outManifest = taskConfig.getOutputManifestPath()
  rimraf(outDir)
  rimraf(outManifest)

  if (!outputFiles || outputFiles.length === 0) return

  mkdirSync(outDir, { recursive: true })

  const rootWorkspaceDir = tasks.config.project.root.dir

  const manifest = createLazyWriteStream(outManifest)

  for (const file of outputFiles) {
    if (file.startsWith('..')) {
      throw logger.fail('output file is outside of workspace: ' + file)
    }
    const absoluteFile = join(rootWorkspaceDir, file)
    const dest = join(outDir, file)
    mkdirSync(dirname(dest), { recursive: true })
    const stat = statSync(absoluteFile)
    copyFileWithMtime(absoluteFile, dest, stat.mtime)
    const timestamp = String(Math.round(stat.mtime.getTime()))

    manifest.write(file + '\t' + timestamp + '\n')
  }

  await manifest.close()
}
