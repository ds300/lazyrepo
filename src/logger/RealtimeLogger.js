/** @typedef {import('../types.js').CliLogger} CliLogger */
import k from 'kleur'
import {
  formatFailMessage,
  formatInfoMessage,
  formatNoteMessage,
  formatSuccessMessage,
  getColorForString,
  prefixLines,
  timeSince,
} from './formatting.js'

/**
 * @implements {CliLogger}
 */
export class RealtimeLogger {
  /**
   * @param {import('node:stream').Writable} stdout
   * @param {import('node:stream').Writable} stderr
   */
  constructor(stdout, stderr) {
    this.stdout = stdout
    this.stderr = stderr
  }

  /**
   * @param {string[]} args
   */
  log(...args) {
    this.stdout.write(args.join(' ') + '\n')
  }

  /**
   * @param {string[]} args
   */
  logErr(...args) {
    this.stderr.write(args.join(' ') + '\n')
  }

  /**
   * @param {string} headline
   * @param {{ error?: Error, detail?: string }} [more]
   * @returns {never}
   */
  fail(headline, more) {
    this.stderr.write('\n\n')
    this.stderr.write(formatFailMessage(headline, more))
    this.stderr.write('\n')
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
   * @returns {import('../types.js').CliLoggerTask}
   */
  task(taskName) {
    let start = Date.now()
    const color = getColorForString(taskName)
    const prefix = color.fg(`${taskName} `)

    let isDone = false
    const assertNotDone = () => {
      if (isDone) {
        throw new Error('This task has already been completed')
      }
    }

    const log = (/** @type {string[]} */ ...args) => {
      assertNotDone()
      this.log(prefixLines(prefix, args.join(' ')))
    }
    const logErr = (/** @type {string[]} */ ...args) => {
      assertNotDone()
      this.logErr(prefixLines(prefix, args.join(' ')))
    }

    return {
      startTimer: () => {
        assertNotDone()
        start = Date.now()
      },
      log,
      logErr,
      fail: (headline, more) => {
        logErr(formatFailMessage(headline, more))
        isDone = true
      },
      success: (message) => {
        log(formatSuccessMessage(message, k.gray(`in ${timeSince(start)}`)))
        isDone = true
      },
      info: (...args) => {
        log(formatInfoMessage(...args))
      },
      note: (...args) => {
        log(formatInfoMessage(...args))
      },
    }
  }
}
