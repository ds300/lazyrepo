import { spawn } from 'cross-spawn'

import pc from 'picocolors'
import stripAnsi from 'strip-ansi'
import { createLazyWriteStream } from '../manifest/createLazyWriteStream.js'
import { join, relative } from '../path.js'

/**
 * @param {import('../types.js').ScheduledTask} task
 * @param {import('./TaskGraph.js').TaskGraph} tasks
 * @returns {Promise<{didSucceed: boolean;}>}
 */
export async function runTask(task, tasks) {
  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)
  const command = taskConfig.command

  const logMode = taskConfig.logMode

  const logStream = createLazyWriteStream(taskConfig.getLogPath())
  const ansiLogStream = createLazyWriteStream(taskConfig.getAnsiLogPath())

  try {
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
        PATH: `./node_modules/.bin:${join(tasks.config.project.root.dir, 'node_modules/.bin')}:${
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
      streamPromises.push(
        childProcessStreamToLines(stdout, (line) => {
          ansiLogStream.write(line + '\n')
          logStream.write(stripAnsi(line) + '\n')
          if (logMode === 'new-only' || logMode === 'full') {
            task.logger.log(line)
          }
        }),
      )
    }
    if (stderr) {
      streamPromises.push(
        childProcessStreamToLines(stderr, (line) => {
          ansiLogStream.write(line + '\n')
          logStream.write(stripAnsi(line) + '\n')
          if (logMode === 'new-only' || logMode === 'full') {
            task.logger.log(line)
          }
        }),
      )
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
  } finally {
    await Promise.all([logStream.close(), ansiLogStream.close()])
  }
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
