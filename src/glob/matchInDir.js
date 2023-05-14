import assert from 'assert'
import { LazyDir } from './fs/LazyDir.js'
import { LazyFile } from './fs/LazyFile.js'
import { RecursiveWildcardMatcher } from './matchers/RecursiveWildcardMatcher.js'

class NextChildren {
  /** @type {Matcher[]} */
  children = []
  /** @type {null | NextChildren} */
  next = null
}

/** @type {NextChildren | null} */
let childrenAllocationPool = null

function acquireNextChildren() {
  if (!childrenAllocationPool) {
    return new NextChildren()
  } else {
    const result = childrenAllocationPool
    childrenAllocationPool = result.next
    result.next = null
    return result
  }
}

/** @param {NextChildren} next */
function relinquishNextChildren(next) {
  next.children.length = 0
  next.next = childrenAllocationPool
  childrenAllocationPool = next
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

  const next = acquireNextChildren()
  let didPush = false

  const includeEntry = () => {
    if (!didPush) {
      result.push(entry.path)
      didPush = true
    }
  }

  /** @param {Matcher} matcher */
  function checkChildMatcher(matcher) {
    const match = matcher.match(entry, options)
    switch (match) {
      case 'none':
        break
      case 'partial':
        // A partial match means that this matcher has children that might match
        // a subpath of this entry, so we need to recurse using this matcher's children.
        assert(matcher.children.length)
        next.children.push(...matcher.children)
        break
      case 'try-next':
      case 'recursive':
        // `try-next` and `recursive` are only return by the RecursiveWildcardMatcher (**).
        // `try-next` means to try using this matcher's children to match the current entry.
        // `recursive` means to do that, but then to also apply the current matcher to the
        // entry's children.
        // See the RecursiveWildcardMatcher class for more details about when these are returned.
        for (const child of matcher.children) {
          const stopEarly = checkChildMatcher(child)
          // stopping early happens when a negative match is found that should prevent this entry
          // from being included (unless there are partial matches 'below' this layer that should be checked)
          if (stopEarly) {
            return true
          }
        }
        if (match !== 'try-next') {
          next.children.push(matcher)
        }
        // If we are matching dirs and this entry is a dir, then we need to
        // check whether this matcher has children. If it does not, then this matcher
        // matches this dir and we should include it in the result.
        if (
          matcher.children.length === 0 &&
          entry instanceof LazyDir &&
          (options.types === 'all' || options.types === 'dirs')
        ) {
          includeEntry()
        }
        break
      case 'terminal':
        if (matcher.negating) {
          // break early
          return true
        }
        if (entry instanceof LazyDir) {
          if (options.expandDirectories) {
            // we need to grab everything in this directory
            next.children.push(new RecursiveWildcardMatcher(false))
          }
        }

        if (
          options.types === 'all' ||
          (options.types === 'dirs' && entry instanceof LazyDir) ||
          (options.types === 'files' && entry instanceof LazyFile)
        ) {
          includeEntry()
        }

        break
      default:
        throw new Error(`Unknown match type: ${match}`)
    }
  }

  for (const child of children) {
    const stopEarly = checkChildMatcher(child)
    if (stopEarly) {
      break
    }
  }

  const follow = !entry.isSymbolicLink || options.symbolicLinks === 'follow'

  if (
    follow &&
    next.children.length &&
    entry instanceof LazyDir &&
    !next.children.every((m) => m.negating)
  ) {
    matchInDir(entry, options, next.children, result)
  }

  relinquishNextChildren(next)

  return result
}
