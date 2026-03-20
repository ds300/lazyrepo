import pc from 'picocolors'
import stripAnsi from 'strip-ansi'
import { cwd } from '../cwd.js'
import { mkdirSync } from '../fs.js'
import { createLazyWriteStream } from '../manifest/createLazyWriteStream.js'
import { dirname, join, relative } from '../path.js'
import { spawn } from './spawn.js'

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
const WINDOWS_SHELL_BUILTINS = new Set([
  'assoc',
  'break',
  'call',
  'chdir',
  'cls',
  'copy',
  'date',
  'del',
  'dir',
  'echo',
  'erase',
  'for',
  'ftype',
  'if',
  'md',
  'mkdir',
  'mklink',
  'move',
  'path',
  'pause',
  'popd',
  'prompt',
  'pushd',
  'rd',
  'ren',
  'rename',
  'rmdir',
  'set',
  'shift',
  'start',
  'time',
  'title',
  'type',
  'ver',
  'verify',
  'vol',
])
const WINDOWS_TRACKING_RUNNER = `
const { spawn } = require('node:child_process')
const [, , mode, ...rest] = process.argv
const child =
  mode === 'shell'
    ? spawn(rest[0], { shell: true, stdio: 'inherit', env: process.env })
    : spawn(rest[0], rest.slice(1), { shell: false, stdio: 'inherit', env: process.env })
child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (err) => {
  console.error(err.message)
  process.exit(1)
})
`.trim()

/**
 * Check whether a command string requires a shell to interpret it.
 * Simple commands like `cat file.txt` or `tsc --build` can be exec'd directly,
 * which avoids routing through Oils on macOS and the associated IPC race conditions.
 * @param {string} command
 */
function commandNeedsShell(command) {
  if (hasUnquotedShellMetacharacters(command)) return true
  const parts = splitCommandArgs(command)
  if (!parts || parts.length === 0) return true
  const [firstWord] = parts
  return (
    SHELL_BUILTINS.has(firstWord) ||
    (process.platform === 'win32' && WINDOWS_SHELL_BUILTINS.has(firstWord.toLowerCase()))
  )
}

/**
 * Detect shell metacharacters that appear outside quoted strings.
 * Characters inside quotes should be treated as plain argv content.
 * @param {string} command
 * @returns {boolean}
 */
function hasUnquotedShellMetacharacters(command) {
  /** @type {"'" | '"' | null} */
  let quote = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (quote === "'") {
      if (ch === "'") quote = null
      continue
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null
      } else if (ch === '\\' && i + 1 < command.length) {
        const next = command[i + 1]
        if (next === '"' || next === '\\') i++
      }
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }

    if (
      ch === '|' ||
      ch === '&' ||
      ch === ';' ||
      ch === '<' ||
      ch === '>' ||
      ch === '(' ||
      ch === ')' ||
      ch === '$' ||
      ch === '`' ||
      ch === '*' ||
      ch === '?' ||
      ch === '#' ||
      ch === '~' ||
      ch === '!' ||
      ch === '{' ||
      ch === '}' ||
      ch === '[' ||
      ch === ']' ||
      ch === '\n'
    ) {
      return true
    }
  }

  return false
}

/**
 * Split a simple shell command string into argv while preserving quoted arguments.
 * Returns `null` for unterminated quotes so callers can fall back to shell execution.
 * @param {string} command
 * @returns {string[] | null}
 */
function splitCommandArgs(command) {
  /** @type {string[]} */
  const parts = []
  let current = ''
  /** @type {"'" | '"' | null} */
  let quote = null

  const pushCurrent = () => {
    if (current) {
      parts.push(current)
      current = ''
    }
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (quote === "'") {
      if (ch === "'") {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null
      } else if (ch === '\\') {
        const next = command[i + 1]
        if (next === '"' || next === '\\') {
          current += next
          i++
        } else {
          current += ch
        }
      } else {
        current += ch
      }
      continue
    }

    if (/\s/.test(ch)) {
      pushCurrent()
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }

    if (ch === '\\') {
      const next = command[i + 1]
      if (next && (/\s/.test(next) || next === '"' || next === "'" || next === '\\')) {
        current += next
        i++
        continue
      }
    }

    current += ch
  }

  if (quote) return null
  pushCurrent()
  return parts
}

/**
 * Build the explicit shell invocation for tracked commands.
 * On Windows, mirror `child_process.spawn({ shell: true })` by using `cmd.exe`
 * instead of forcing Git Bash, which changes runtime behavior and can crash.
 * @param {string} command
 * @returns {string[]}
 */
function getTrackingShellArgs(command) {
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', command]
  }
  return ['bash', '-c', command]
}

/**
 * Route tracked Windows commands through Node's child_process so behavior matches
 * the untracked execution path, including PATHEXT resolution and shell quoting.
 * @param {string} command
 * @param {string[] | null} parts
 * @returns {string[]}
 */
function getWindowsTrackingRunnerArgs(command, parts) {
  if (parts) {
    return ['node', '-e', WINDOWS_TRACKING_RUNNER, 'direct', ...parts]
  }
  return ['node', '-e', WINDOWS_TRACKING_RUNNER, 'shell', command]
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
    const useTracking = cache !== 'none' && cache.auto !== false
    if (useTracking) {
      trackingOutputPath = taskConfig
        .getManifestPath()
        .replace('manifest.tsv', 'tracked-inputs.json')
      mkdirSync(dirname(trackingOutputPath), { recursive: true })
      const fullCommand = task.extraArgs.length ? `${command} ${task.extraArgs.join(' ')}` : command

      /** @type {string[]} */
      let fspyArgs
      if (process.platform === 'win32') {
        const needsShell = commandNeedsShell(fullCommand)
        const parts = needsShell ? null : splitCommandArgs(fullCommand)
        if (!needsShell && (!parts || parts.length === 0)) {
          throw new Error(`Could not parse command: ${fullCommand}`)
        }
        fspyArgs = [
          '--output',
          trackingOutputPath,
          '--',
          ...getWindowsTrackingRunnerArgs(fullCommand, parts),
        ]
      } else if (commandNeedsShell(fullCommand)) {
        fspyArgs = ['--output', trackingOutputPath, '--', ...getTrackingShellArgs(fullCommand)]
      } else {
        const parts = splitCommandArgs(fullCommand)
        if (!parts || parts.length === 0) {
          throw new Error(`Could not parse command: ${fullCommand}`)
        }
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
