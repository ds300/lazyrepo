import { basename, join } from 'path'
import { readdirSync, statSync } from '../../fs.js'
import { LazyFile } from './LazyFile.js'

export class LazyDir {
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
  #lastListTime

  /** @type {number} */
  #lastStatTime

  /** @type {null | {order: import('./LazyEntry.js').LazyEntry[], byName: Record<string, import('./LazyEntry.js').LazyEntry>}} */
  #_listing

  /**
   * @param {LogicalClock} clock
   * @param {string} path
   * @param {number} mtime
   * @param {boolean} isSymbolicLink
   */
  constructor(clock, path, mtime, isSymbolicLink) {
    this.#clock = clock
    this.path = path
    this.name = basename(path)
    this.#mtime = mtime

    this.#_listing = null
    this.#lastListTime = clock.time - 1
    this.#lastStatTime = clock.time
    this.isSymbolicLink = isSymbolicLink
  }

  #updateStat() {
    if (this.#lastStatTime === this.#clock.time) {
      return false
    }
    const stat = statSync(this.path)
    const didChange = this.#mtime !== stat.mtimeMs
    this.#mtime = stat.mtimeMs
    return didChange
  }

  get listing() {
    if (this.#_listing && this.#clock.time === this.#lastListTime) {
      return this.#_listing
    }
    const didChange = this.#updateStat()
    if (!this.#_listing || didChange) {
      const prevListingByName = this.#_listing?.byName
      this.#_listing = {
        order: [],
        byName: {},
      }

      for (const entry of readdirSync(this.path, { withFileTypes: true })) {
        let result = prevListingByName?.[entry.name]
        if (entry.isDirectory() && (!result || !(result instanceof LazyDir))) {
          const stat = statSync(join(this.path, entry.name))
          result = new LazyDir(this.#clock, join(this.path, entry.name), stat.mtimeMs, false)
        } else if (entry.isFile() && (!result || !(result instanceof LazyFile))) {
          result = new LazyFile(this.#clock, join(this.path, entry.name), 0, 0, false)
        } else if (entry.isSymbolicLink()) {
          try {
            const stat = statSync(join(this.path, entry.name))
            if (stat.isDirectory()) {
              result = new LazyDir(this.#clock, join(this.path, entry.name), stat.mtimeMs, true)
            } else if (stat.isFile()) {
              result = new LazyFile(
                this.#clock,
                join(this.path, entry.name),
                stat.mtimeMs,
                stat.size,
                true,
              )
            }
          } catch (_e) {
            // ignore
          }
        }
        if (result) {
          this.#_listing.order.push(result)
          this.#_listing.byName[entry.name] = result
        }
      }

      this.#lastListTime = this.#clock.time
    }
    return this.#_listing
  }
}
