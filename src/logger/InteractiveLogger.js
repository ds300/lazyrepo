/** @typedef {import('../types.js').CliLogger} CliLogger */

import k from 'kleur'
import _sliceAnsi from 'slice-ansi'
import {
  formatFailMessage,
  formatInfoMessage,
  formatNoteMessage,
  formatSuccessMessage,
  getColorForString,
  lastNonEmptyLineIfPossible,
  timeSince,
} from './formatting.js'

const sliceAnsi = _sliceAnsi.default || _sliceAnsi

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'].map((s) => k.cyan(s + ' '))

/** @typedef {'waiting' | 'running' | 'done' | 'failed'} TaskStatus */

/**
 * @typedef {Object} Task
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

    setInterval(() => {
      if (this.tasks.length) {
        this.moveCursorToAboveTasksSection()
        this.printTasks()
      }
    }, 30)
  }

  /** @private */
  getTasksToPrint() {
    return this.tasks.filter((task) => task.status !== 'waiting').sort(compareTasksForPrinting)
  }

  /** @private */
  printTasks() {
    const spinnerFrame = spinnerFrames[Math.floor(Date.now() / 60) % spinnerFrames.length]
    for (const task of this.getTasksToPrint()) {
      let message = task.lastLogLine || k.gray(task.status)
      if (task.status === 'running') {
        message = spinnerFrame + message
      }
      message = task.coloredPrefix + message

      this.tty.write(sliceAnsi(message, 0, this.tty.columns))
      this.tty.clearLine(1)
      this.tty.write('\n')
    }
    this.tty.write('\n')
    this.tty.clearLine(1)
    this.isCursorAboveTasksSection = false
  }

  /** @private */
  moveCursorToAboveTasksSection() {
    if (!this.isCursorAboveTasksSection) {
      this.tty.cursorTo(0)
      this.tty.moveCursor(0, -this.getTasksToPrint().length - 1)
      this.isCursorAboveTasksSection = true
    }
  }

  clearTasks() {
    this.tasks = []
  }

  /**
   * @param {string[]} args
   */
  log(...args) {
    this.moveCursorToAboveTasksSection()
    this.tty.clearScreenDown()
    this.tty.write(args.join(' ') + '\n')
    this.printTasks()
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
    let start = Date.now()
    const color = getColorForString(taskName)
    const prefix = color.fg(`${taskName} `)

    this.moveCursorToAboveTasksSection()

    /** @type {Task} */
    const task = {
      prefix: taskName,
      coloredPrefix: prefix,
      lastLogLine: '',
      status: 'waiting',
      startedAt: start,
    }

    this.tasks.push(task)
    this.printTasks()

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

      // if the status changes, we need to reprint the tasks immediately. if
      // not, we can just wait for our interval loop to do it
      const didStatusChange = task.status !== status
      if (didStatusChange) {
        this.moveCursorToAboveTasksSection()
        task.status = status
      }

      const message = args.join(' ')
      bufferedLogLines.push(message)
      const lastLine = lastNonEmptyLineIfPossible(message)
      if (lastLine) {
        task.lastLogLine = lastLine
      }

      if (didStatusChange) {
        this.printTasks()
      }
    }

    const complete = (/** @type {TaskStatus} */ status, /** @type {string} */ message) => {
      assertNotDone()
      this.moveCursorToAboveTasksSection()
      this.tty.clearScreenDown()
      task.status = status
      const lastLine = lastNonEmptyLineIfPossible(message)
      if (lastLine) {
        task.lastLogLine = lastLine
      }

      bufferedLogLines.push(message)
      this.tty.write(color.fg(':: ') + color.bg().bold(` ${taskName} `) + color.fg(' ::') + '\n')
      for (const line of bufferedLogLines) {
        this.tty.write(line + '\n')
      }
      this.tty.write('\n')

      isDone = true
      this.printTasks()
    }

    return {
      restartTimer: () => {
        assertNotDone()
        start = Date.now()
        task.startedAt = start
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
        complete('done', formatSuccessMessage(message, k.gray(`in ${timeSince(start)}`)))
      },
      info: (...args) => {
        log('running', formatInfoMessage(...args))
      },
      note: (...args) => {
        log('running', formatNoteMessage(...args))
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
