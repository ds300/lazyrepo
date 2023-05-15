import { BaseMatcher } from './BaseMatcher.js'

/** @implements {Matcher} */
export class RootMatcher extends BaseMatcher {
  constructor() {
    super(false)
  }
  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} _entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(_entry, _options) {
    return this.children
  }
}
