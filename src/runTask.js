import { spawn } from 'cross-spawn'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import kleur from 'kleur'
import path, { relative } from 'path'
import stripAnsi from 'strip-ansi'
import { getDiffPath, getManifestPath, getNextManifestPath, getTask } from './config.js'
import { logger } from './logger/logger.js'
import { computeManifest } from './manifest/computeManifest.js'
import { workspaceRoot } from './workspaceRoot.js'

/**
 * @param {import('./types.js').ScheduledTask} task
 * @param {import('./TaskGraph.js').TaskGraph} tasks
 * @returns {Promise<{didRunTask: boolean, didSucceed: boolean}>}
 */
export async function runTaskIfNeeded(task, tasks) {
  task.logger.restartTimer()

  const previousManifestPath = getManifestPath(task)
  const nextManifestPath = getNextManifestPath(task)

  const didHaveManifest = existsSync(previousManifestPath)

  const didChange = await computeManifest({
    task,
    tasks,
  })

  let didRunTask = false
  let didSucceed = false

  if (task.force) {
    task.logger.log('cache miss, --force flag used')

    didSucceed = (await runTask(task)).didSucceed
    didRunTask = true
  } else if (didChange === null) {
    task.logger.log('cache disabled')
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
      task.logger.note('cache miss, changes since last run:')
      allLines.slice(0, 10).forEach((line) => task.logger.note(line))
      if (allLines.length > 10) {
        task.logger.note(`... and ${allLines.length - 10} more. See ${diffPath} for full diff.`)
      }
    } else if (!didHaveManifest) {
      task.logger.log('cache miss, no previous manifest found')
    }
    didSucceed = (await runTask(task)).didSucceed
    didRunTask = true
  } else {
    // cache hit
  }

  if (!didRunTask || didSucceed) {
    task.logger.note('input manifest saved: ' + path.relative(workspaceRoot, previousManifestPath))
  }

  if (didRunTask) {
    if (didSucceed) {
      renameSync(nextManifestPath, previousManifestPath)
      task.logger.success('done')
    } else if (existsSync(previousManifestPath)) {
      unlinkSync(previousManifestPath)
      task.logger.fail('failed')
    }
  } else {
    task.logger.success(`cache hit ⚡️`)
  }

  return { didRunTask, didSucceed: !didRunTask || didSucceed }
}

/**
 * @param {import('./types.js').ScheduledTask} task
 * @returns {Promise<{didSucceed: boolean;}>}
 */
async function runTask(task) {
  const packageJson = JSON.parse(readFileSync(`${task.taskDir}/package.json`, 'utf8'))
  const taskConfig = await getTask({ taskName: task.taskName })
  let command =
    taskConfig.runType === 'top-level' ? taskConfig.baseCommand : packageJson.scripts[task.taskName]
  if (taskConfig.runType !== 'top-level' && command.startsWith('lazy :inherit')) {
    if (!taskConfig.baseCommand) {
      // TODO: evaluate this stuff ahead-of-time
      logger.fail(
        `Encountered 'lazy :inherit' for scripts#${task.taskName} in ${task.taskDir}/package.json, but there is baseCommand configured for the task '${task.taskName}'`,
      )
      process.exit(1)
    }
    command = taskConfig.baseCommand + ' ' + command.slice('lazy :inherit'.length)
    command = command.trim()
  }

  // const start = Date.now()

  task.logger.log(
    kleur.bold(' RUN ') +
      kleur.green().bold(command) +
      (task.extraArgs.length ? kleur.cyan().bold(' ' + task.extraArgs.join(' ')) : '') +
      kleur.gray(' in ' + relative(process.cwd(), task.taskDir)),
  )

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

  let streamPromises = []
  const { stdout, stderr } = proc
  if (stdout) {
    childProcessStreamToLines(stdout, (line) => task.logger.log(line))
    streamPromises.push(new Promise((resolve) => stdout.on('close', resolve)))
  }
  if (stderr) {
    childProcessStreamToLines(stderr, (line) => task.logger.logErr(line))
    streamPromises.push(new Promise((resolve) => stderr.on('close', resolve)))
  }

  // if the process exits with a non-zero status, we'll fail the build
  let status = 0

  const finishPromise = new Promise((resolve) => {
    proc.on('exit', (code) => {
      status = code ?? 1
      resolve(null)
    })

    proc.on('error', (err) => {
      status = 1
      resolve(null)
      task.logger.log(err.message)
    })
  })

  await Promise.all([finishPromise, ...streamPromises])

  return { didSucceed: status === 0 }
}

/**
 * @param {import("stream").Readable} stream
 * @param {(line: string) => void} onLine
 */
function childProcessStreamToLines(stream, onLine) {
  let pendingLine = ''
  stream.on('data', (/** @type {{ toString: (arg0: 'utf-8') => string; }} */ chunk) => {
    const chunkString = chunk.toString('utf-8')

    const lines = chunkString.split('\n')
    lines[0] = pendingLine + lines[0]
    pendingLine = lines.pop() ?? ''

    for (const line of lines) {
      onLine(line)
    }
  })
  stream.on('close', () => {
    onLine(pendingLine)
  })
}
