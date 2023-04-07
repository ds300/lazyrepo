import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import kleur from 'kleur'
import { getDiffPath, getManifestPath } from './config.js'
import { log } from './log.js'

import path from 'path'
import stripAnsi from 'strip-ansi'
import { compareManifests, renderChange } from './manifest/compareManifests.js'
import { writeManifest } from './manifest/writeManifest.js'

/**
 * @param {import('./types.js').ScheduledTask} task
 * @returns {Promise<boolean>}
 */
export async function runIfNeeded(task) {
  const currentManifestPath = getManifestPath(task)
  const previousManifestPath = currentManifestPath + '.prev'

  log.log(`${kleur.bold(task.taskName)} 🎁 ${kleur.red(path.relative(process.cwd(), task.cwd))}`)

  const didHaveManifest = existsSync(currentManifestPath)

  /**
   * @type {Record<string, [hash: string, lastModified: number]> | undefined}
   */
  let prevManifest

  if (didHaveManifest) {
    renameSync(currentManifestPath, previousManifestPath)
    const prevManifestString = readFileSync(previousManifestPath, 'utf-8').toString()
    prevManifest = {}
    for (const line of prevManifestString.split('\n')) {
      const [thing, hash, lastModified] = line.split('\t')
      if (thing.startsWith('file ')) {
        const filePath = thing.slice('file '.length)
        prevManifest[filePath] = [hash, Number(lastModified)]
      }
    }
  }

  await writeManifest({ ...task, prevManifest })

  let didRunCommand = false

  if (didHaveManifest) {
    const diff = compareManifests(
      readFileSync(previousManifestPath).toString(),
      readFileSync(currentManifestPath).toString(),
    )

    if (diff.length) {
      const allLines = diff.map(renderChange)
      const diffPath = getDiffPath(task)
      if (!existsSync(path.dirname(diffPath))) {
        mkdirSync(path.dirname(diffPath), { recursive: true })
      }
      writeFileSync(diffPath, stripAnsi(allLines.join('\n')))
      log.substep('Cache miss, changes since last run:')
      allLines.slice(0, 10).forEach(log.substep)
      if (allLines.length > 10) {
        log.substep(`... and ${allLines.length - 10} more. See ${diffPath} for full diff.`)
      }

      await runCommand(task)
      didRunCommand = true
    }
  } else {
    await runCommand(task)
    didRunCommand = true
  }

  if (!didRunCommand) {
    log.step(`Cache hit! 🎉\n`)
  }

  return didRunCommand
}

/**
 * @param {import('./types.js').ScheduledTask} task
 * @returns {Promise<void>}
 */
export async function runCommand(task) {
  const packageJson = JSON.parse(readFileSync(`${task.cwd}/package.json`, 'utf8'))
  const command =
    packageJson.scripts[task.taskName.startsWith('//#') ? task.taskName.slice(3) : task.taskName]

  const extraArgs = process.argv.slice(3)
  const color = log.step(kleur.green().bold(command))
  const start = Date.now()
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(command + ' ' + extraArgs.join(' '), {
        stdio: 'inherit',
        shell: true,
        cwd: task.cwd,
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:./node_modules/.bin:${process.cwd()}/node_modules/.bin`,
        },
      })
      proc.on('error', reject)
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(null)
        } else {
          reject(new Error(`Command '${command}' exited with code ${code}`))
        }
      })
    })
  } catch (e) {
    const manifestPath = getManifestPath(task)
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath)
    }
    throw e
  }

  log.log(kleur.gray(`\n              ∙  ∙  ∙\n`))
  log.step(`Done in ${kleur.cyan(((Date.now() - start) / 1000).toFixed(2) + 's')}`)
}
