import fs from 'fs'
import path from 'path'
import { TaskGraph } from '../TaskGraph.js'
import { getManifestPath } from '../config.js'
import { log } from '../log.js'
import { getManifest } from './getManifest.js'

/**
 * @param {{ task: import('../types.js').ScheduledTask, tasks: TaskGraph,  prevManifest?: Record<string, [hash: string, lastModified: number]> }} param0
 * @returns
 */
export async function writeManifest({ task, tasks, prevManifest }) {
  /**
   * @param  {string} msg
   */
  const print = (msg) => log.log(task.terminalPrefix, msg)

  const outputPath = getManifestPath(task)
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  }

  const manifest = await getManifest({ task, tasks, prevManifest })
  if (!manifest) {
    print('cache disabled')
    return
  }

  const out = fs.createWriteStream(outputPath)

  for (const line of manifest) {
    out.write(line)
    out.write('\n')
  }

  return new Promise((resolve) => {
    out.on('close', resolve)
    out.close()
  })
}
