import { LazyFile } from '../fs/LazyFile.js'
import { BaseMatcher } from './BaseMatcher.js'

/** @implements {Matcher} */
export class RecursiveWildcardMatcher extends BaseMatcher {
  /**
   * @param {import("../fs/LazyEntry.js").LazyEntry} entry
   * @param {MatchOptions} options
   * @return {MatchResult}
   */
  match(entry, options) {
    const ignore = entry.name[0] === '.' && !options.dot
    if (this.children.length === 0) {
      // negative wildcards always match dotfiles
      if (this.negating) return 'terminal'
      return ignore
        ? 'none'
        : options.expandDirectories || entry instanceof LazyFile
        ? 'terminal'
        : { recur: this.children, down: [this] }
    } else {
      // If this entry is a dotfile and we're not matching dotfiles, then
      // a child matcher might still match the dotfile, so we don't want to ignore
      // it entirely.
      // e.g. we are matching "**/.lazy" with dot: false and comparing the "**" segment
      // against a dir called ".lazy". Normally the "**" would fail because it's a dotfile,
      // and we would ignore the ".lazy" dir entirely. But in this case, the ".lazy" dir should
      // match because it is explicitly named in the pattern.

      // The 'try-next' match result asks the caller to try this matcher's
      // children, but not to recursively apply this matcher to the entry's children.

      // 'recursive' means to recursively apply this matcher to the entry's children while
      // also trying the children of this matcher against the entry.
      return { recur: this.children, down: ignore ? undefined : [this] }
    }
  }
}
