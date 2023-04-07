import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { cyan, gray, green } from 'kleur'
import { getDiffPath, getManifestPath } from './config'
import { log } from './log'

import kleur from 'kleur'
import path from 'path'
import stripAnsi from 'strip-ansi'
import { compareManifests, renderChange } from './manifest/compareManifests'
import { writeManifest } from './manifest/writeManifest'

export async function runIfNeeded({
  taskName,
  cwd,
}: {
  taskName: string
  cwd: string
}): Promise<boolean> {
  const currentManifestPath = getManifestPath({ taskName, cwd })
  const previousManifestPath = currentManifestPath + '.prev'

  log.log(`${kleur.bold(taskName)} 🎁 ${kleur.red(path.relative(process.cwd(), cwd))}`)

  const didHaveManifest = existsSync(currentManifestPath)

  let prevManifest: Record<string, [hash: string, lastModified: number]> | undefined

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

  await writeManifest({ taskName, cwd, prevManifest })

  let didRunCommand = false

  if (didHaveManifest) {
    const diff = compareManifests({
      currentManifest: readFileSync(currentManifestPath).toString(),
      previousManifest: readFileSync(previousManifestPath).toString(),
    })

    if (diff.length) {
      const allLines = diff.map(renderChange)
      const diffPath = getDiffPath({ taskName, cwd })
      if (!existsSync(path.dirname(diffPath))) {
        mkdirSync(path.dirname(diffPath), { recursive: true })
      }
      writeFileSync(diffPath, stripAnsi(allLines.join('\n')))
      log.substep('Cache miss, changes since last run:')
      allLines.slice(0, 10).forEach(log.substep)
      if (allLines.length > 10) {
        log.substep(`... and ${allLines.length - 10} more. See ${diffPath} for full diff.`)
      }

      await runCommand({ taskName, cwd })
      didRunCommand = true
    }
  } else {
    await runCommand({ taskName, cwd })
    didRunCommand = true
  }

  if (!didRunCommand) {
    log.step(`Cache hit! 🎉\n`)
  }

  return didRunCommand
}

export async function runCommand({ taskName, cwd }: { taskName: string; cwd: string }) {
  const packageJson = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'))
  const command = packageJson.scripts[taskName.startsWith('//#') ? taskName.slice(3) : taskName]

  const extraArgs = process.argv.slice(3)
  const color = log.step(green().bold(command))
  const start = Date.now()
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(command + ' ' + extraArgs.join(' '), {
        stdio: 'inherit',
        shell: true,
        cwd,
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
    const manifestPath = getManifestPath({ taskName, cwd })
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath)
    }
    throw e
  }

  log.log(gray(`\n              ∙  ∙  ∙\n`))
  log.step(`Done in ${cyan(((Date.now() - start) / 1000).toFixed(2) + 's')}`)
}
