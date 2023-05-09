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
  children = []

  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(entry, _options) {
    // the dot option is handled by micromatch
    if (this.#pattern.test(entry.name)) {
      return this.children.length === 0 ? 'terminal' : 'partial'
    } else {
      return 'none'
    }
  }
}
