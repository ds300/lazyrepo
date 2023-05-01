/** @typedef {import('../types.js').CliLogger} CliLogger */
import pc from 'picocolors'
import { createTimer } from '../utils/createTimer.js'
import {
  formatDiffMessage,
  formatFailMessage,
  formatInfoMessage,
  formatNoteMessage,
  formatSuccessMessage,
  formatWarningMessage,
  getColorForString,
  prefixLines,
} from './formatting.js'

import ci from 'ci-info'
import { LazyError } from './LazyError.js'
/**
 * @implements {CliLogger}
 */
export class RealtimeLogger {
  /**
   * @param {import('node:stream').Writable} stdout
   */
  constructor(stdout) {
    this.stdout = stdout
  }

  /**
   * @param {string[]} args
   */
  log(...args) {
    this.stdout.write(args.join(' ') + '\n')
  }

  stop() {
    // noop
  }

  /**
   * @param {string} headline
   * @param {{ error?: Error, detail?: string }} [more]
   * @returns {never}
   */
  fail(headline, more) {
    throw new LazyError(headline, more)
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
   * @param {string} title
   * @param {string} content
   */
  group(title, content) {
    if (ci.TRAVIS) {
      this.log(`travis_fold:start:${title}`)
      this.log(content)
      this.log(`travis_fold:end:${title}`)
    } else if (ci.GITLAB) {
      this.log(
        `section_start:${Math.floor(Date.now() / 1000)}:${title
          .toLowerCase()
          .replace(/\W+/g, `_`)}[collapsed=true]\r\x1b[0K${title}`,
      )
      this.log(content)
      this.log(
        `section_end:${Math.floor(Date.now() / 1000)}:${title
          .toLowerCase()
          .replace(/\W+/g, `_`)}\r\x1b[0K`,
      )
    } else if (ci.GITHUB_ACTIONS) {
      this.log(`::group::${title}`)
      this.log(content)
      this.log('::endgroup::')
    } else {
      this.log(title)
      this.log('[ grouped content suppressed on unsupported CI environment ]')
    }
  }

  get isVerbose() {
    return false
  }

  /**
   * @param {string} taskName
   * @param {boolean} isVerbose
   * @returns {import('../types.js').TaskLogger}
   */
  task(taskName, isVerbose) {
    const timer = createTimer()
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

    return {
      isVerbose,
      restartTimer: () => {
        assertNotDone()
        timer.reset()
      },
      log,
      fail: (headline, more) => {
        log(formatFailMessage(headline, more))
        isDone = true
      },
      success: (message) => {
        log(formatSuccessMessage(message, pc.gray(`in ${timer.formatElapsedTime()}`)))
        isDone = true
      },
      info: (...args) => {
        log(formatInfoMessage(...args))
      },
      group: (title, content) => {
        this.group(prefix + ' ' + title, content)
      },
      note: (...args) => {
        log(formatInfoMessage(...args))
      },
      diff: (diffLine) => {
        log(formatDiffMessage(diffLine))
      },
      warn: (...args) => {
        log(formatWarningMessage(...args))
      },
    }
  }
}
