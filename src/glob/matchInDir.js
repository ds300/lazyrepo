import { LazyDir } from './fs/LazyDir.js'
import { LazyFile } from './fs/LazyFile.js'
import { RecursiveWildcardMatcher } from './matchers/RecursiveWildcardMatcher.js'

class MatcherIterator {
  constructor(
    /** @type {Matcher[]} */
    matchers,
    /** @type {MatcherIterator | null} */
    below,
  ) {
    this.below = below
    this.matchers = matchers
    this.index = 0
  }

  /** @returns {Matcher | undefined} */
  next() {
    if (this.index >= this.matchers.length) {
      if (!this.below) return undefined
      this.matchers = this.below.matchers
      this.index = this.below.index
      this.below = this.below.below
      return this.next()
    }
    return this.matchers[this.index++]
  }
}

/**
 * @param {LazyDir} dir
 * @param {MatchOptions} options
 * @param {Matcher[]} matchers
 * @param {string[]} [result]
 */
export function matchInDir(dir, options, matchers, result = []) {
  for (const child of dir.getListing().order) {
    // ignore files when we're only matching directories
    if (options.types === 'dirs' && !(child instanceof LazyDir)) continue
    // ignore any symbolic links if we are ignoring symbolic links
    if (child.isSymbolicLink && options.symbolicLinks === 'ignore') continue
    matchDirEntry(child, options, matchers, result)
  }
  return result
}

const RECURSE = new RecursiveWildcardMatcher(false)

// function createPerfTimer() {
//   const timer = createTimer()
//   let total = 0n
//   return {
//     start() {
//       timer.reset()
//     },
//     stop() {
//       total += timer.getElapsedNs()
//     },
//     getElapsedNs() {
//       return total
//     },
//   }
// }

// const timers = {
//   include: createPerfTimer(),
//   iter: createPerfTimer(),
//   match: createPerfTimer(),
//   arrayCheck: createPerfTimer(),
//   every: createPerfTimer(),
// }

/**
 * @param {import("./fs/LazyEntry.js").LazyEntry} entry
 * @param {MatchOptions} options
 * @param {Matcher[]} children
 * @param {string[]} result
 */
function matchDirEntry(entry, options, children, result) {
  // We evaluate the children from bottom to top, so that we can stop early
  // if things are negated.

  // While doing that we build up a list of 'next' children to pass down if this entry
  // is a directory that should also be traversed.

  // In doing so we can filter out any parts of the matcher tree which are not useful for
  // matching against nested files/dirs.

  /** @type {Matcher[]} */
  const nextChildren = []
  let didPush = false

  const includeEntry = () => {
    if (!didPush) {
      result.push(entry.path)
      didPush = true
    }
  }

  let iter = new MatcherIterator(children, null)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const matcher = iter.next()
    if (!matcher) break

    const match = matcher.match(entry, options)
    if (match === 'none') continue

    if (Array.isArray(match)) {
      const l = match.length
      for (let i = 0; i < l; i++) {
        nextChildren.push(match[i])
      }
      continue
    }
    if (match === 'terminal') {
      if (matcher.negating) {
        // break early
        break
      }
      if (entry instanceof LazyDir) {
        if (options.expandDirectories) {
          // we need to grab everything in this directory
          nextChildren.push(RECURSE)
        }
      }

      if (
        options.types === 'all' ||
        (options.types === 'dirs' && entry instanceof LazyDir) ||
        (options.types === 'files' && entry instanceof LazyFile)
      ) {
        includeEntry()
      }

      continue
    }

    if (match.down) {
      nextChildren.push(...match.down)
    }
    if (match.recur) {
      iter = new MatcherIterator(matcher.children, iter)
    }

    // check whether this matcher has children. If it does not, then this matcher
    // matches this dir and we should include it in the result.
    if (
      matcher.children.length === 0 &&
      entry instanceof LazyDir &&
      (options.types === 'all' || options.types === 'dirs')
    ) {
      includeEntry()
    }
  }

  const follow = !entry.isSymbolicLink || options.symbolicLinks === 'follow'

  if (
    follow &&
    nextChildren.length &&
    entry instanceof LazyDir &&
    !nextChildren.every((m) => m.negating)
  ) {
    matchInDir(entry, options, nextChildren, result)
  }

  return result
}
