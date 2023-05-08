import { LazyFile } from '../fs/LazyFile.js'

/** @implements {Matcher} */
export class RecursiveWildcardMatcher {
  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {boolean} negating
   */
  constructor(negating) {
    this.negating = negating
  }
  /** @type {Matcher[]} */
  next = []
  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} entry
   * @param {MatchOptions} options
   * @return {MatchResult}
   */
  match(entry, options) {
    const ignore = entry.name[0] === '.' && !options.dot
    if (this.next.length === 0) {
      if (this.negating) return 'terminal'
      return ignore
        ? 'none'
        : options.expandDirectories || entry instanceof LazyFile
        ? 'terminal'
        : 'recursive'
    } else {
      return ignore ? 'try-next' : 'recursive'
    }
  }
}
