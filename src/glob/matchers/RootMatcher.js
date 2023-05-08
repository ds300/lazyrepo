/** @implements {Matcher} */
export class RootMatcher {
  /**
   * @type {boolean}
   * @readonly
   */
  negating = false

  /** @type {Matcher[]} */
  children = []

  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} _entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(_entry, _options) {
    return 'partial'
  }
}
