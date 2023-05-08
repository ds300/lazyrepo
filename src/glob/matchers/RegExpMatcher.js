/** @implements {Matcher} */
export class RegExpMatcher {
  /**
   * @type {RegExp}
   */
  #pattern

  /**
   * @type {string}
   * @readonly
   */
  source

  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {string} source
   * @param {RegExp} pattern
   * @param {boolean} negating
   */
  constructor(source, pattern, negating) {
    this.source = source
    this.#pattern = pattern
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
    if (this.#pattern.test(entry.name)) {
      return this.next.length === 0 ? 'terminal' : 'partial'
    } else {
      return 'none'
    }
  }
}
