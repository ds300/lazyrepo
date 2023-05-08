import { basename } from 'path'
import { statSync } from '../../fs.js'
import { hashFile } from '../../manifest/hash.js'

export class LazyFile {
  /** @type {LogicalClock} */
  #clock
  /**
   * @type {string}
   * @readonly
   */
  path
  /**
   * @type {boolean}
   * @readonly
   */
  isSymbolicLink
  /**
   * @type {string}
   * @readonly
   */
  name
  /** @type {number} */
  #mtime
  /** @type {number} */
  #size

  /** @type {number} */
  #lastHashTime

  /** @type {number} */
  #lastStatTime

  /** @type {null | string} */
  #_hash

  /**
   * @param {LogicalClock} clock
   * @param {string} path
   * @param {number} mtime
   * @param {number} size
   * @param {boolean} isSymbolicLink
   */
  constructor(clock, path, mtime, size, isSymbolicLink) {
    this.#clock = clock
    this.path = path
    this.name = basename(path)
    this.#mtime = mtime
    this.#size = size

    this.#_hash = null
    this.#lastHashTime = clock.time - 1
    this.#lastStatTime = clock.time
    this.isSymbolicLink = isSymbolicLink
  }

  #updateStat() {
    if (this.#lastStatTime === this.#clock.time) {
      return false
    }
    const stat = statSync(this.path)
    const didChange = this.#mtime !== stat.mtimeMs || this.#size !== stat.size
    this.#mtime = stat.mtimeMs
    this.#size = stat.size
    return didChange
  }

  get hash() {
    if (this.#_hash && this.#clock.time === this.#lastHashTime) {
      return this.#_hash
    }
    const didChange = this.#updateStat()
    if (!this.#_hash || didChange) {
      this.#_hash = hashFile(this.path, this.#size)
      this.#lastHashTime = this.#clock.time
    }
    return this.#_hash
  }
}
