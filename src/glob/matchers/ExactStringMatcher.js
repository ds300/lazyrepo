import { BaseMatcher } from './BaseMatcher.js'

/** @implements {Matcher} */
export class ExactStringMatcher extends BaseMatcher {
  /**
   * @type {string}
   * @readonly
   */
  pattern

  /**
   * @param {string} pattern
   * @param {boolean} negating
   */
  constructor(pattern, negating) {
    super(negating)
    this.pattern = pattern
  }

  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(entry, _options) {
    if (this.pattern === entry.name) {
      return this.children.length === 0 ? 'terminal' : this.children
    } else {
      return 'none'
    }
  }
}
