import { BaseMatcher } from './BaseMatcher.js'

/** @implements {Matcher} */
export class RegExpMatcher extends BaseMatcher {
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
    super(negating)
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
