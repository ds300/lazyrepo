import { spawn } from 'cross-spawn'

import path, { relative } from 'path'
import pc from 'picocolors'
import stripAnsi from 'strip-ansi'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from './fs.js'
import { isCi } from './isCi.js'
import { computeManifest } from './manifest/computeManifest.js'

/**
 * @param {import('./types.js').ScheduledTask} task
 * @param {import('./TaskGraph.js').TaskGraph} tasks
 * @returns {Promise<{didRunTask: boolean, didSucceed: boolean}>}
 */
export async function runTaskIfNeeded(task, tasks) {
  task.logger.restartTimer()

  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)

  const previousManifestPath = taskConfig.getManifestPath()
  const nextManifestPath = taskConfig.getNextManifestPath()

  const didHaveManifest = existsSync(previousManifestPath)

  const manifestResult = await computeManifest({
    task,
    tasks,
  })

  let didRunTask = false
  let didSucceed = false

  if (task.force) {
    task.logger.log('cache miss, --force flag used')

    didSucceed = (await runTask(task, tasks)).didSucceed
    didRunTask = true
  } else if (manifestResult === null) {
    task.logger.log('cache disabled')
    didSucceed = (await runTask(task, tasks)).didSucceed
    didRunTask = true
  } else if (manifestResult.didChange) {
    const diffPath = taskConfig.getDiffPath()
    const diff = existsSync(diffPath) ? readFileSync(diffPath, 'utf-8').toString() : null
    if (diff?.length) {
      if (isCi) {
        task.logger.note('cache miss')
        task.logger.group('changes since last run', diff)
      } else {
        const allLines = diff.split('\n')
        const diffPath = taskConfig.getDiffPath()
        if (!existsSync(path.dirname(diffPath))) {
          mkdirSync(path.dirname(diffPath), { recursive: true })
        }
        writeFileSync(diffPath, stripAnsi(allLines.join('\n')))
        task.logger.note('cache miss, changes since last run:')
        allLines.slice(0, 10).forEach((line) => task.logger.diff(line))
        if (allLines.length > 10) {
          task.logger.note(`... and ${allLines.length - 10} more. See ${diffPath} for full diff.`)
        }
      }
    } else if (!didHaveManifest) {
      task.logger.log('cache miss, no previous manifest found')
    }
    didSucceed = (await runTask(task, tasks)).didSucceed
    didRunTask = true
  } else {
    // cache hit
  }

  if (!didRunTask || didSucceed) {
    task.logger.note(
      'input manifest saved: ' + path.relative(tasks.config.project.root.dir, previousManifestPath),
    )
    if (isCi) {
      task.logger.group(
        'input manifest',
        readFileSync(
          manifestResult?.didWriteManifest ? nextManifestPath : previousManifestPath,
        ).toString(),
      )
    }
  }

  if (didRunTask) {
    if (didSucceed) {
      if (manifestResult?.didWriteManifest) {
        renameSync(nextManifestPath, previousManifestPath)
      }
      task.logger.success('done')
    } else {
      if (existsSync(previousManifestPath)) {
        unlinkSync(previousManifestPath)
      }
      task.logger.fail('failed')
    }
  } else {
    task.logger.success(`cache hit ⚡️`)
  }

  return { didRunTask, didSucceed: !didRunTask || didSucceed }
}

/**
 * @param {import('./types.js').ScheduledTask} task
 * @param {import('./TaskGraph.js').TaskGraph} tasks
 * @returns {Promise<{didSucceed: boolean;}>}
 */
async function runTask(task, tasks) {
  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)
  const command = taskConfig.command

  task.logger.log(
    pc.bold('RUN ') +
      pc.green(pc.bold(command)) +
      (task.extraArgs.length ? pc.cyan(pc.bold(' ' + task.extraArgs.join(' '))) : '') +
      pc.gray(' in ' + relative(process.cwd(), task.workspace.dir) ?? './'),
  )

  const proc = spawn(command, task.extraArgs, {
    cwd: task.workspace.dir,
    shell: true,
    stdio: ['ignore'],
    env: {
      ...process.env,
      PATH: `./node_modules/.bin:${path.join(tasks.config.project.root.dir, 'node_modules/.bin')}:${
        process.env.PATH ?? ''
      }`,
      FORCE_COLOR: '1',
      npm_lifecycle_event: task.scriptName,
      __LAZY_WORKFLOW__: 'true',
    },
  })

  let streamPromises = []
  const { stdout, stderr } = proc
  if (stdout) {
    streamPromises.push(childProcessStreamToLines(stdout, (line) => task.logger.log(line)))
  }
  if (stderr) {
    streamPromises.push(childProcessStreamToLines(stderr, (line) => task.logger.logErr(line)))
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
  return new Promise((resolve) => {
    stream.on('close', () => {
      if (pendingLine) {
        onLine(pendingLine)
      }
      resolve(null)
    })
  })
}
