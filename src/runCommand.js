import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import kleur from 'kleur'
import { spawn } from 'node-pty'
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

  /**
   * @param  {string} msg
   */
  const print = (msg) => console.log(task.terminalPrefix, msg)

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

  await writeManifest({ task, prevManifest })

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
      print('cache miss, changes since last run:')
      allLines.slice(0, 10).forEach((line) => print(kleur.gray(line)))
      if (allLines.length > 10) {
        print(kleur.gray(`... and ${allLines.length - 10} more. See ${diffPath} for full diff.`))
      }

      await runCommand(task)
      didRunCommand = true
    }
  } else {
    await runCommand(task)
    didRunCommand = true
  }

  print(kleur.gray('input manifest saved: ' + path.relative(process.cwd(), currentManifestPath)))

  if (!didRunCommand) {
    print(`cache hit ⚡️`)
  }

  return didRunCommand
}

/**
 * @param {import('./types.js').ScheduledTask} task
 * @returns {Promise<void>}
 */
async function runCommand(task) {
  const packageJson = JSON.parse(readFileSync(`${task.cwd}/package.json`, 'utf8'))
  const command = packageJson.scripts[task.taskName]

  const extraArgs = process.argv.slice(3)
  const start = Date.now()

  console.log(task.terminalPrefix + kleur.bold(' RUN ') + kleur.green().bold(command))
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('/usr/bin/env', ['sh', '-c', command + ' ' + extraArgs.join(' ')], {
        cwd: task.cwd,
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:./node_modules/.bin:${process.cwd()}/node_modules/.bin`,
          FORCE_COLOR: '1',
        },
      })
      // forward all output to the terminal without losing color
      let buf = ''
      proc.onData((data) => {
        buf += data
        const lastCarriageReturn = buf.lastIndexOf('\n')
        if (lastCarriageReturn === -1) {
          return
        }

        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          process.stdout.write(task.terminalPrefix + ' ' + line + '\n')
        }
      })

      proc.onExit(({ exitCode }) => {
        if (buf) {
          process.stdout.write(task.terminalPrefix + ' ' + buf + '\n')
        }
        if (exitCode === 0) {
          resolve(null)
        } else {
          reject(new Error(`Command '${command}' exited with code ${exitCode}`))
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

  log.log(
    task.terminalPrefix,
    `done in ${kleur.cyan(((Date.now() - start) / 1000).toFixed(2) + 's')}`,
  )
}
