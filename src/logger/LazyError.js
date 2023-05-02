import stripAnsi from 'strip-ansi'
import { formatFailMessage } from './formatting.js'

export class LazyError extends Error {
  /**
   * @param {string} headline
   * @param {{ error?: Error, detail?: string }} [more]
   */
  constructor(headline, more) {
    super(stripAnsi(headline))
    this.headline = headline
    this.more = more
  }

  format() {
    return formatFailMessage(this.headline, this.more)
  }
}
