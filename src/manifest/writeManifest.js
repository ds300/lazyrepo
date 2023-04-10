import fs from 'fs'
import path from 'path'
import { getDiffPath, getManifestPath } from '../config.js'
import { log } from '../log.js'
import { ManifestConstructor } from './computeManifest.js'
import { getManifest } from './getManifest.js'

/**
 * @param {{ task: import('../types.js').ScheduledTask, tasks: import('../TaskGraph.js').TaskGraph,  prevManifest: string | null }} param0
 * @returns
 */
export async function writeManifest({ task, tasks, prevManifest }) {
  /**
   * @param  {string} msg
   */
  const print = (msg) => log.log(task.terminalPrefix, msg)

  const outputPath = getManifestPath(task)
  const diffPath = prevManifest !== null ? getDiffPath(task) : null

  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  }
  if (diffPath && !fs.existsSync(path.dirname(diffPath))) {
    fs.mkdirSync(path.dirname(diffPath), { recursive: true })
  }

  const manifestOutStream = fs.createWriteStream(outputPath)
  const diffOutStream = diffPath ? fs.createWriteStream(diffPath) : null

  const manifestConstructor = new ManifestConstructor(
    prevManifest,
    manifestOutStream,
    diffOutStream,
  )

  const didChange = await getManifest({ task, tasks, manifestConstructor })
  if (didChange === null) {
    print('cache disabled')
    return
  }

  return Promise.all([
    new Promise((resolve) => {
      manifestOutStream.on('close', resolve)
      manifestOutStream.close()
    }),

    diffOutStream
      ? new Promise((resolve) => {
          diffOutStream.on('close', resolve)
          diffOutStream.close()
        })
      : Promise.resolve(),
  ])
}
