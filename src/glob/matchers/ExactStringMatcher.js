/** @implements {Matcher} */
export class ExactStringMatcher {
  /**
   * @type {string}
   * @readonly
   */
  pattern

  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {string} pattern
   * @param {boolean} negating
   */
  constructor(pattern, negating) {
    this.pattern = pattern
    this.negating = negating
  }

  /** @type {Matcher[]} */
  next = []

  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(entry, _options) {
    if (this.pattern === entry.name) {
      return this.next.length === 0 ? 'terminal' : 'partial'
    } else {
      return 'none'
    }
  }
}
