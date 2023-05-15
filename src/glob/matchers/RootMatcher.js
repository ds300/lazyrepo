/** @implements {Matcher} */
export class RootMatcher {
  /** @type {Matcher[]} */
  children = []

  negating = false

  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} _entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(_entry, _options) {
    return this.children
  }
}
