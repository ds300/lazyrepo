import assert from 'assert'
import { join } from 'path'
import { readFileSync, statSync } from '../fs.js'
import { getOutputFiles } from '../manifest/getInputFiles.js'
import { rimraf } from '../utils/rimraf.js'
import { copyFileWithMtime } from './copyFileWithMtime.js'

/**
 * @param {import("../tasks/TaskGraph.js").TaskGraph} tasks
 * @param {import("../types.js").ScheduledTask} task
 */
export function restoreOutputs(tasks, task) {
  const outputFiles = getOutputFiles(tasks, task)
  if (!outputFiles) return

  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)
  const outDir = taskConfig.getOutputPath()
  const outManifest = taskConfig.getOutputManifestPath()
  const manifest = readFileSync(outManifest, 'utf-8')
    .toString()
    .trim()
    .split('\n')
    .map((line) => line.split('\t'))

  const workspaceRoot = tasks.config.project.root.dir

  let currentIdx = 0
  let manifestIdx = 0
  while (currentIdx < outputFiles.length || manifestIdx < manifest.length) {
    // handle case where we are restoring missing files
    if (
      currentIdx >= outputFiles.length ||
      (manifestIdx < manifest.length && outputFiles[currentIdx] > manifest[manifestIdx][0])
    ) {
      // file does not exist, so we need to restore it
      const [file, timestamp] = manifest[manifestIdx]
      if (task.logger.isVerbose) {
        task.logger.log('restoring missing file:', file)
      }
      copyFileWithMtime(join(outDir, file), join(workspaceRoot, file), new Date(Number(timestamp)))
      manifestIdx++
      continue
    }

    // handle case where we are deleting files that weren't in the manifest
    if (manifestIdx >= manifest.length || outputFiles[currentIdx] < manifest[manifestIdx][0]) {
      // file is not in the manifest, so we need to delete it
      // file is not in the manifest, so we need to delete it
      task.logger.warn('removing stale output file', outputFiles[currentIdx])
      rimraf(join(workspaceRoot, outputFiles[currentIdx]))
      currentIdx++
      continue
    }

    // otherwise they should be the same file and we should check whether it has changed
    const [file, timestamp] = manifest[manifestIdx]
    assert(outputFiles[currentIdx] === file, 'restoreOutputs file mismatch')

    const absolutePath = join(workspaceRoot, file)
    const stat = statSync(absolutePath)
    if (Math.round(stat.mtime.getTime()) === Number(timestamp)) {
      // nothing to do
      if (task.logger.isVerbose) task.logger.log('unchanged', file)
    } else {
      // file has changed, so we need to restore it
      if (task.logger.isVerbose) {
        task.logger.log('overwriting changed file', file, timestamp, String(stat.mtime.getTime()))
      }
      copyFileWithMtime(join(outDir, file), absolutePath, new Date(Number(timestamp)))
    }
    currentIdx++
    manifestIdx++
  }

  const n = manifest.length
  if (n) {
    task.logger.log(`restored ${n} output file${n === 1 ? '' : 's'}`)
  }
}
