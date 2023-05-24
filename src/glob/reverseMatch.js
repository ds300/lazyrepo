import assert from 'assert'
import { LazyDir } from './fs/LazyDir.js'
import { LazyFile } from './fs/LazyFile.js'

/**
 * @param {import("./fs/LazyEntry.js").LazyEntry} entry
 * @param {MatchOptions} options
 * @param {Matcher[]} matchers
 * @returns {boolean}
 */
export function reverseMatch(entry, options, matchers) {
  /** @type {Matcher[]} */
  const nextMatchers = []

  let i = 0
  /** @type {Matcher | null} */
  let stashedMatcher = null
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const matcher = stashedMatcher ?? matchers[i++]
    if (!matcher) break
    stashedMatcher = null

    const match = matcher.match(entry, options, matcher)
    if (match === 'none') continue

    if (match === 'next') {
      assert(matcher.next)
      nextMatchers.push(matcher.next)
      continue
    }
    if (match === 'terminal') {
      if (
        options.types === 'all' ||
        (options.types === 'dirs' && entry instanceof LazyDir) ||
        (options.types === 'files' && entry instanceof LazyFile)
      ) {
        return true
      }

      continue
    }

    if (match === 'recur') {
      nextMatchers.push(matcher)
      if (matcher.next) {
        stashedMatcher = /** @type {Matcher} */ (matcher.next)
      } else if (options.types !== 'files') {
        // ** should match dirs if there is no next matcher and types is not 'files'
        return true
      }
      continue
    }

    if (match === 'try-next') {
      if (matcher.next) {
        stashedMatcher = /** @type {Matcher} */ (matcher.next)
      }
      continue
    }

    if (match === 'up') {
      assert(entry instanceof LazyDir)
      assert(matcher.next)
      for (const child of entry.getListing().order) {
        if (!(child instanceof LazyDir)) continue

        const isMatch = reverseMatch(child, options, [matcher.next])
        if (isMatch) return true
      }
    }

    // check whether this matcher has children. If it does not, then this matcher
    // matches this dir and we should include it in the result.
    if (
      !matcher.next &&
      entry instanceof LazyDir &&
      (options.types === 'all' || options.types === 'dirs')
    ) {
      return true
    }
  }

  if (nextMatchers.length && entry.parentDir !== entry) {
    return reverseMatch(entry.parentDir, options, nextMatchers)
  }

  return false
}
