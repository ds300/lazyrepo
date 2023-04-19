/** @typedef {import('../types.js').CliLogger} CliLogger */

import pc from 'picocolors'
import _sliceAnsi from 'slice-ansi'
import { createTimer } from '../createTimer.js'
import {
  formatDiffMessage,
  formatFailMessage,
  formatInfoMessage,
  formatNoteMessage,
  formatSuccessMessage,
  formatWarningMessage,
  getColorForString,
  lastNonEmptyLineIfPossible,
} from './formatting.js'

const sliceAnsi = _sliceAnsi.default || _sliceAnsi

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'].map((s) =>
  pc.cyan(s + ' '),
)

/** @typedef {'waiting' | 'running' | 'done' | 'failed'} TaskStatus */

/**
 * @typedef {Object} Task
 *
 *
 * @property {string} prefix
 * @property {string} coloredPrefix
 * @property {string} lastLogLine
 * @property {TaskStatus} status
 * @property {number} startedAt
 */

/** @implements {CliLogger} */
export class InteractiveLogger {
  /** @type {Task[]} */
  tasks = []

  /** @type {boolean} */
  isCursorAboveTasksSection = true

  /**
   * @param {import('node:tty').WriteStream} tty
   */
  constructor(tty) {
    this.tty = tty
  }

  /** @private */
  getTasksToPrint() {
    return this.tasks.filter((task) => task.status !== 'waiting').sort(compareTasksForPrinting)
  }

  /** @type {ReturnType<typeof setInterval> | null} */
  animationInterval = null

  /**
   * @param {() => void} [update]
   */
  update(update) {
    if (this.animationInterval === null) {
      this.animationInterval = setInterval(() => {
        if (this.tasks.length) {
          this.update()
        }
      }, 30)
    }
    if (!this.isCursorAboveTasksSection) {
      this.tty.cursorTo(0)
      this.tty.moveCursor(0, -this.getTasksToPrint().length - 1)
      this.isCursorAboveTasksSection = true
    }

    if (update) update()

    const spinnerFrame = spinnerFrames[Math.floor(Date.now() / 60) % spinnerFrames.length]
    for (const task of this.getTasksToPrint()) {
      let message = task.lastLogLine || pc.gray(task.status)
      if (task.status === 'running') {
        message = spinnerFrame + message
      }
      message = task.coloredPrefix + message

      this.tty.write(sliceAnsi(message.replaceAll('\t', '   '), 0, this.tty.columns))
      this.tty.clearLine(1)
      this.tty.write('\n')
    }
    this.tty.write('\n')
    this.tty.clearLine(1)
    this.isCursorAboveTasksSection = false
  }

  clearTasks() {
    this.tasks = []
    if (this.animationInterval) clearInterval(this.animationInterval)
  }

  /**
   * @param {string[]} args
   */
  log(...args) {
    this.update(() => {
      this.tty.clearScreenDown()
      this.tty.write(args.join(' ') + '\n')
    })
  }
  /**
   * @param {string[]} args
   */
  logErr(...args) {
    this.log(...args)
  }

  /**
   * @param {string} headline
   * @param {{ error?: Error, detail?: string }} [more]
   * @returns {never}
   */
  fail(headline, more) {
    this.tty.write('\n\n')
    this.tty.write(formatFailMessage(headline, more))
    this.tty.write('\n')
    process.exit(1)
  }

  /**
   * @param {string[]} args
   */
  info(...args) {
    this.log(formatInfoMessage(...args))
  }

  /**
   * @param {string[]} args
   */
  note(...args) {
    this.log(formatNoteMessage(...args))
  }

  /**
   * @param {string[]} args
   */
  warn(...args) {
    this.log(formatWarningMessage(...args))
  }

  /**
   * @param {string} message
   */
  success(message) {
    this.log(formatSuccessMessage(message))
  }

  /**
   * @param {string} taskName
   * @returns {import('../types.js').TaskLogger}
   */
  task(taskName) {
    const timer = createTimer()
    const color = getColorForString(taskName)
    const prefix = color.fg(`${taskName} `)

    /** @type {Task} */
    const task = {
      prefix: taskName,
      coloredPrefix: prefix,
      lastLogLine: '',
      status: 'waiting',
      startedAt: timer.getStartTime(),
    }

    this.update(() => {
      this.tasks.push(task)
    })

    let isDone = false
    const assertNotDone = () => {
      if (isDone) {
        throw new Error('This task has already been completed')
      }
    }

    /** @type {string[]} */
    const bufferedLogLines = []

    const log = (/** @type {TaskStatus} */ status, /** @type {string[]} */ ...args) => {
      assertNotDone()

      const addLogLines = () => {
        task.status = status
        const message = args.join(' ')
        bufferedLogLines.push(message)
        const lastLine = lastNonEmptyLineIfPossible(message)
        if (lastLine) {
          task.lastLogLine = lastLine
        }
      }

      const didStatusChange = task.status !== status
      if (didStatusChange) {
        this.update(addLogLines)
      } else {
        addLogLines()
      }
    }

    const complete = (/** @type {TaskStatus} */ status, /** @type {string} */ message) => {
      assertNotDone()
      this.update(() => {
        this.tty.clearScreenDown()
        task.status = status
        const lastLine = lastNonEmptyLineIfPossible(message)
        if (lastLine) {
          task.lastLogLine = lastLine
        }

        bufferedLogLines.push(message)
        this.tty.write(
          color.fg(':: ') + color.bg(pc.bold(` ${taskName} `)) + color.fg(' ::') + '\n',
        )
        for (const line of bufferedLogLines) {
          this.tty.write(line + '\n')
        }
        this.tty.write('\n')

        isDone = true
      })
    }

    return {
      restartTimer: () => {
        assertNotDone()
        timer.reset()
        task.startedAt = timer.getStartTime()
      },
      log: (...args) => {
        log('running', ...args)
      },
      logErr: (...args) => {
        log('running', ...args)
      },
      fail: (headline, more) => {
        complete('failed', formatFailMessage(headline, more))
      },
      success: (message) => {
        complete('done', formatSuccessMessage(message, pc.gray(`in ${timer.formatElapsedTime()}`)))
      },
      info: (...args) => {
        log('running', formatInfoMessage(...args))
      },
      warn: (...args) => {
        log('running', formatWarningMessage(...args))
      },
      note: (...args) => {
        log('running', formatNoteMessage(...args))
      },
      diff: (diff) => {
        log('running', formatDiffMessage(diff))
      },
    }
  }
}

/**
 * @param {Task} a
 * @param {Task} b
 */
function compareTasksForPrinting(a, b) {
  if (a.startedAt < b.startedAt) {
    return -1
  }
  if (a.startedAt > b.startedAt) {
    return 1
  }
  if (a.prefix < b.prefix) {
    return -1
  }
  if (a.prefix > b.prefix) {
    return 1
  }
  return 0
}
