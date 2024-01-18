import assert from 'assert'
import { matcher, recursiveWildcardMatchFn } from './compile/matcher.js'
import { LazyDir } from './fs/LazyDir.js'
import { LazyFile } from './fs/LazyFile.js'

/**
 * @param {LazyDir} dir
 * @param {MatchOptions} options
 * @param {Matcher[]} matchers
 * @param {GlobResult} result
 */
export function matchInDir(dir, options, matchers, result) {
  for (const child of dir.getListing().order) {
    // ignore files when we're only matching directories
    if (options.types === 'dirs' && !(child instanceof LazyDir)) continue
    // ignore any symbolic links if we are ignoring symbolic links
    if (child.isSymbolicLink && options.symbolicLinks === 'ignore') continue
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    matchDirEntry(child, options, matchers, result, false)
  }
  return
}

/**
 * @param {LazyDir} dir
 * @param {MatchOptions} options
 * @param {Matcher[]} matchers
 * @param {GlobResult} result
 */
export async function matchInDirAsync(dir, options, matchers, result) {
  const order = (await dir.getListingAsync()).order
  await Promise.all(
    order.map((child) => {
      // ignore files when we're only matching directories
      if (options.types === 'dirs' && !(child instanceof LazyDir)) return
      // ignore any symbolic links if we are ignoring symbolic links
      if (child.isSymbolicLink && options.symbolicLinks === 'ignore') return
      return matchDirEntry(child, options, matchers, result, true)
    }),
  )
}

/**
 * @param {LazyDir} dir
 * @param {MatchOptions} options
 * @param {Matcher[]} matchers
 */
export async function* matchInDirStream(dir, options, matchers) {
  for (const child of (await dir.getListingAsync()).order) {
    // ignore files when we're only matching directories
    if (options.types === 'dirs' && !(child instanceof LazyDir)) continue
    // ignore any symbolic links if we are ignoring symbolic links
    if (child.isSymbolicLink && options.symbolicLinks === 'ignore') continue

    yield* matchDirEntryStream(child, options, matchers)
  }
}

const RECURSE = matcher('**', false, recursiveWildcardMatchFn)

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
 * @param {GlobResult} result
 * @param {boolean} async
 */
function matchDirEntry(entry, options, children, result, async) {
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

  let i = 0
  /** @type {Matcher | null} */
  let stashedMatcher = null
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const matcher = stashedMatcher ?? children[i++]
    if (!matcher) break
    stashedMatcher = null

    const match = matcher.match(entry, options, matcher)
    if (match === 'none') continue

    if (match === 'next') {
      assert(matcher.next)
      nextChildren.push(matcher.next)
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

    if (match === 'recur') {
      nextChildren.push(matcher)
      if (matcher.next) {
        stashedMatcher = /** @type {Matcher} */ (matcher.next)
      } else if (options.types !== 'files') {
        // ** should match dirs if there is no next matcher and types is not 'files'
        includeEntry()
      }
      continue
    }

    if (match === 'try-next') {
      if (matcher.next) {
        stashedMatcher = /** @type {Matcher} */ (matcher.next)
      }
      continue
    }

    // check whether this matcher has children. If it does not, then this matcher
    // matches this dir and we should include it in the result.
    if (
      !matcher.next &&
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
    if (async) {
      return matchInDirAsync(entry, options, nextChildren, result)
    } else {
      matchInDir(entry, options, nextChildren, result)
    }
  }
}

/**
 * @param {import("./fs/LazyEntry.js").LazyEntry} entry
 * @param {MatchOptions} options
 * @param {Matcher[]} children
 * @returns {AsyncGenerator<string, void, void>}
 */
async function* matchDirEntryStream(entry, options, children) {
  // We evaluate the children from bottom to top, so that we can stop early
  // if things are negated.

  // While doing that we build up a list of 'next' children to pass down if this entry
  // is a directory that should also be traversed.

  // In doing so we can filter out any parts of the matcher tree which are not useful for
  // matching against nested files/dirs.

  /** @type {Matcher[]} */
  const nextChildren = []
  let didYield = false

  let i = 0
  /** @type {Matcher | null} */
  let stashedMatcher = null
  while (true) {
    const matcher = stashedMatcher ?? children[i++]
    if (!matcher) break
    stashedMatcher = null

    const match = matcher.match(entry, options, matcher)
    if (match === 'none') continue

    if (match === 'next') {
      assert(matcher.next)
      nextChildren.push(matcher.next)
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
        if (!didYield) {
          yield entry.path
          didYield = true
        }
      }

      continue
    }

    if (match === 'recur') {
      nextChildren.push(matcher)
      if (matcher.next) {
        stashedMatcher = /** @type {Matcher} */ (matcher.next)
      } else if (options.types !== 'files') {
        // ** should match dirs if there is no next matcher and types is not 'files'
        if (!didYield) {
          yield entry.path
          didYield = true
        }
      }
      continue
    }

    if (match === 'try-next') {
      if (matcher.next) {
        stashedMatcher = /** @type {Matcher} */ (matcher.next)
      }
      continue
    }

    // check whether this matcher has children. If it does not, then this matcher
    // matches this dir and we should include it in the result.
    if (
      !matcher.next &&
      entry instanceof LazyDir &&
      (options.types === 'all' || options.types === 'dirs')
    ) {
      if (!didYield) {
        yield entry.path
        didYield = true
      }
    }
  }

  const follow = !entry.isSymbolicLink || options.symbolicLinks === 'follow'

  if (
    follow &&
    nextChildren.length &&
    entry instanceof LazyDir &&
    !nextChildren.every((m) => m.negating)
  ) {
    yield* matchInDirStream(entry, options, nextChildren)
  }
}
