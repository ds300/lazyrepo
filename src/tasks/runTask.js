import pc from 'picocolors'
import stripAnsi from 'strip-ansi'
import { cwd } from '../cwd.js'
import { mkdirSync } from '../fs.js'
import { createLazyWriteStream } from '../manifest/createLazyWriteStream.js'
import { dirname, join, relative } from '../path.js'
import { spawn } from './spawn.js'

const SHELL_METACHARACTERS = /[|&;<>()$`\\"'*?#~!{}[\]\n]/
const SHELL_BUILTINS = new Set([
  'exit',
  'cd',
  'export',
  'source',
  'eval',
  'exec',
  'set',
  'unset',
  'alias',
  'type',
  'read',
  'let',
  'declare',
  'local',
  'return',
  'trap',
  'wait',
  'shift',
  'builtin',
  'command',
  'ulimit',
  'umask',
  'true',
  'false',
  'test',
  'pushd',
  'popd',
  'dirs',
  'hash',
  'getopts',
  'times',
])

/**
 * Check whether a command string requires a shell to interpret it.
 * Simple commands like `cat file.txt` or `tsc --build` can be exec'd directly,
 * which avoids routing through Oils on macOS and the associated IPC race conditions.
 * @param {string} command
 */
function commandNeedsShell(command) {
  if (SHELL_METACHARACTERS.test(command)) return true
  const firstWord = command.trim().split(/\s+/)[0]
  return SHELL_BUILTINS.has(firstWord)
}

/**
 * @param {import('../types.js').ScheduledTask} task
 * @param {import('./TaskGraph.js').TaskGraph} tasks
 * @returns {Promise<{didSucceed: boolean, trackingOutputPath: string | null}>}
 */
export async function runTask(task, tasks) {
  const taskConfig = tasks.config.getTaskConfig(task.workspace, task.scriptName)
  const command = taskConfig.command

  const logMode = taskConfig.logMode

  const logStream = createLazyWriteStream(taskConfig.getLogPath())
  const ansiLogStream = createLazyWriteStream(taskConfig.getAnsiLogPath())

  /** @type {string | null} */
  let trackingOutputPath = null

  try {
    task.logger.log(
      pc.bold('RUN ') +
        pc.green(pc.bold(command)) +
        (task.extraArgs.length ? pc.cyan(pc.bold(' ' + task.extraArgs.join(' '))) : '') +
        pc.gray(' in ' + (relative(cwd, task.workspace.dir) || './')),
    )

    const taskEnv = {
      ...process.env,
      PATH: `./node_modules/.bin:${join(tasks.config.project.root.dir, 'node_modules/.bin')}:${
        process.env.PATH ?? ''
      }`,
      FORCE_COLOR: '1',
      npm_lifecycle_event: task.scriptName,
      __LAZY_WORKFLOW__: 'true',
    }

    /** @type {import('child_process').ChildProcessWithoutNullStreams} */
    let proc

    const cache = taskConfig.cache
    const useTracking = tasks.fspyBinaryPath && cache !== 'none' && cache.auto !== false
    if (useTracking) {
      trackingOutputPath = taskConfig
        .getManifestPath()
        .replace('manifest.tsv', 'tracked-inputs.json')
      mkdirSync(dirname(trackingOutputPath), { recursive: true })
      const fullCommand = task.extraArgs.length ? `${command} ${task.extraArgs.join(' ')}` : command

      /** @type {string[]} */
      let fspyArgs
      if (commandNeedsShell(fullCommand)) {
        fspyArgs = ['--output', trackingOutputPath, '--', 'bash', '-c', fullCommand]
      } else {
        const parts = fullCommand.trim().split(/\s+/)
        fspyArgs = ['--output', trackingOutputPath, '--', ...parts]
      }

      proc = spawn(tasks.fspyBinaryPath, fspyArgs, {
        cwd: task.workspace.dir,
        shell: false,
        stdio: [null],
        env: taskEnv,
      })
    } else {
      proc = spawn(command, task.extraArgs, {
        cwd: task.workspace.dir,
        shell: true,
        stdio: [null],
        env: taskEnv,
      })
    }

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

    return { didSucceed: status === 0, trackingOutputPath }
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
