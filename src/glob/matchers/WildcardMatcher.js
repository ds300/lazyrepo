/** @implements {Matcher} */
export class WildcardMatcher {
  /** @type {Matcher[]} */
  next = []

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

  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} entry
   * @param {MatchOptions} options
   * @return {MatchResult}
   */
  match(entry, options) {
    if (entry.name[0] === '.' && !options.dot && !this.negating) {
      return 'none'
    }
    return this.next.length === 0 ? 'terminal' : 'partial'
  }
}
