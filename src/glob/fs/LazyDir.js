import { readdirSync, statSync } from '../../fs.js'
import { basename } from '../../path.js'
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
   * @type {boolean}
   * @readonly
   */
  noCache

  /**
   * @param {LogicalClock} clock
   * @param {string} path
   * @param {number} mtime
   * @param {boolean} isSymbolicLink
   * @param {boolean} noCache
   */
  constructor(clock, path, mtime, isSymbolicLink, noCache) {
    this.#clock = clock
    this.path = path
    this.name = basename(path)
    this.#mtime = mtime

    this.#_listing = null
    this.#lastListTime = clock.time - 1
    this.#lastStatTime = clock.time
    this.isSymbolicLink = isSymbolicLink
    this.noCache = noCache
  }

  #updateStat() {
    // If there's no cache, we will never be re-traversing a directory from a previous time,
    // so we can skip the stat.
    if (this.noCache) return false
    if (this.#lastStatTime === this.#clock.time) {
      return false
    }
    const stat = statSync(this.path)
    const didChange = this.#mtime !== stat.mtimeMs
    this.#mtime = stat.mtimeMs
    return didChange
  }

  getListing() {
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

      try {
        for (const entry of readdirSync(this.path, { withFileTypes: true })) {
          let result = prevListingByName?.[entry.name]
          const entryPath = this.path === '/' ? '/' + entry.name : this.path + '/' + entry.name
          try {
            if (entry.isDirectory() && (!result || !(result instanceof LazyDir))) {
              result = new LazyDir(
                this.#clock,
                entryPath,
                this.noCache ? 0 : statSync(entryPath).mtimeMs,
                false,
                this.noCache,
              )
            } else if (entry.isFile() && (!result || !(result instanceof LazyFile))) {
              result = new LazyFile(entryPath, false)
            } else if (entry.isSymbolicLink()) {
              const stat = statSync(entryPath)
              if (stat.isDirectory()) {
                result = new LazyDir(this.#clock, entryPath, stat.mtimeMs, true, this.noCache)
              } else if (stat.isFile()) {
                result = new LazyFile(entryPath, true)
              }
            }
          } catch (_e) {
            // ignore
          }

          if (result) {
            this.#_listing.order.push(result)
            this.#_listing.byName[entry.name] = result
          }
        }
      } catch (_e) {
        // ignore
      }

      this.#lastListTime = this.#clock.time
    }
    return this.#_listing
  }
}
