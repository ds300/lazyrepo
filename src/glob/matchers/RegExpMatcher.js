/** @implements {Matcher} */
export class RegExpMatcher {
  /** @type {Matcher[]} */
  children = []
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
   * @param {string} source
   * @param {RegExp} pattern
   * @param {boolean} negating
   */
  constructor(source, pattern, negating) {
    this.negating = negating
    this.source = source
    this.#pattern = pattern
  }

  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(entry, _options) {
    // the dot option is handled by micromatch
    if (this.#pattern.test(entry.name)) {
      return this.children.length === 0 ? 'terminal' : this.children
    } else {
      return 'none'
    }
  }
}
