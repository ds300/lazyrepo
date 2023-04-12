import { spawn } from 'cross-spawn'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import kleur from 'kleur'
import path, { relative } from 'path'
import { Transform } from 'stream'
import stripAnsi from 'strip-ansi'
import { getDiffPath, getManifestPath, getNextManifestPath, getTask } from './config.js'
import { log } from './log.js'
import { computeManifest } from './manifest/computeManifest.js'
import { workspaceRoot } from './workspaceRoot.js'

/**
 * @param {import('./types.js').ScheduledTask} task
 * @param {import('./TaskGraph.js').TaskGraph} tasks
 * @returns {Promise<{didRunTask: boolean, didSucceed: boolean}>}
 */
export async function runTaskIfNeeded(task, tasks) {
  const previousManifestPath = getManifestPath(task)
  const nextManifestPath = getNextManifestPath(task)

  /**
   * @param  {string} msg
   */
  const print = (msg) => console.log(task.terminalPrefix, msg)

  const didHaveManifest = existsSync(previousManifestPath)

  const didChange = await computeManifest({
    task,
    tasks,
  })

  let didRunTask = false
  let didSucceed = false

  if (task.force) {
    print('cache miss, --force flag used')
    didSucceed = (await runTask(task)).didSucceed
    didRunTask = true
  } else if (didChange === null) {
    print('cache disabled')
    didSucceed = (await runTask(task)).didSucceed
    didRunTask = true
  } else if (didChange) {
    const diffPath = getDiffPath(task)
    const diff = existsSync(diffPath) ? readFileSync(diffPath, 'utf-8').toString() : null
    if (diff?.length) {
      const allLines = diff.split('\n')
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
    } else if (!didHaveManifest) {
      print('cache miss, no previous manifest found')
    }
    didSucceed = (await runTask(task)).didSucceed
    didRunTask = true
  } else {
    print(`cache hit ⚡️`)
  }

  if (!didRunTask || didSucceed) {
    print(kleur.gray('input manifest saved: ' + path.relative(workspaceRoot, previousManifestPath)))
  }

  if (didRunTask) {
    if (didSucceed) {
      renameSync(nextManifestPath, previousManifestPath)
    } else if (existsSync(previousManifestPath)) {
      unlinkSync(previousManifestPath)
    }
  }

  return { didRunTask, didSucceed: !didRunTask || didSucceed }
}

/**
 * @param {import('node:stream').Writable} stream
 * @param {string} prefix
 */
const prefixedWriteStream = (stream, prefix) => {
  let outData = ''
  return new Transform({
    write(chunk, _encoding, callback) {
      outData += chunk.toString('utf8')
      callback?.()
      const lastLineFeed = outData.lastIndexOf('\n')
      if (lastLineFeed === -1) {
        return
      }

      const lines = outData.replaceAll('\r', '').split('\n')
      outData = lines.pop() || ''

      for (const line of lines) {
        stream.write(prefix + ' ' + line + '\n', 'utf8')
      }
    },
  })
}

/**
 * @param {import('./types.js').ScheduledTask} task
 * @returns {Promise<{didSucceed: boolean}>}
 */
async function runTask(task) {
  const packageJson = JSON.parse(readFileSync(`${task.taskDir}/package.json`, 'utf8'))
  const taskConfig = await getTask({ taskName: task.taskName })
  let command =
    taskConfig.runType === 'top-level' ? taskConfig.baseCommand : packageJson.scripts[task.taskName]
  if (taskConfig.runType !== 'top-level' && command.startsWith('lazy :inherit')) {
    if (!taskConfig.baseCommand) {
      // TODO: evaluate this stuff ahead-of-time
      log.fail(
        `Encountered 'lazy :inherit' for scripts#${task.taskName} in ${task.taskDir}/package.json, but there is baseCommand configured for the task '${task.taskName}'`,
      )
      process.exit(1)
    }
    command = taskConfig.baseCommand + ' ' + command.slice('lazy :inherit'.length)
    command = command.trim()
  }

  const start = Date.now()

  console.log(
    task.terminalPrefix +
      kleur.bold(' RUN ') +
      kleur.green().bold(command) +
      (task.extraArgs.length ? kleur.cyan().bold(' ' + task.extraArgs.join(' ')) : '') +
      kleur.gray(' in ' + relative(process.cwd(), task.taskDir)),
  )

  const out = prefixedWriteStream(process.stdout, task.terminalPrefix)
  const err = prefixedWriteStream(process.stderr, task.terminalPrefix)
  const proc = spawn(command, task.extraArgs, {
    cwd: task.taskDir,
    shell: true,
    stdio: ['ignore'],
    env: {
      ...process.env,
      PATH: `${process.env.PATH}:./node_modules/.bin:${workspaceRoot}/node_modules/.bin`,
      FORCE_COLOR: '1',
      npm_lifecycle_event: task.taskName,
    },
  })

  proc.stdout?.pipe(out)
  proc.stderr?.pipe(err)

  // if the process exits with a non-zero status, we'll fail the build
  let status = 0

  await new Promise((resolve) => {
    proc.on('exit', (code) => {
      status = code ?? 1
      resolve(null)
    })

    proc.on('error', (err) => {
      status = 1
      resolve(null)
      console.error(err)
    })
  })

  log.log(
    task.terminalPrefix,
    `done in ${kleur.cyan(((Date.now() - start) / 1000).toFixed(2) + 's')}`,
  )

  return { didSucceed: status === 0 }
}
