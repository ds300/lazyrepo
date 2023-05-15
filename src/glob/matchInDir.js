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

class MatcherIterator {
  /** @type {Matcher[][]} */
  stack = []
  /** @type {number[]} */
  indices = []

  /** @returns {Matcher | null} */
  next() {
    if (this.stack.length === 0) return null
    const topElems = this.stack[this.stack.length - 1]
    const topIndex = this.indices[this.indices.length - 1]
    if (topIndex >= topElems.length) {
      this.stack.pop()
      this.indices.pop()
      return this.next()
    }
    this.indices[this.indices.length - 1]++
    return topElems[topIndex]
  }

  /** @param {Matcher[]} matchers */
  push(matchers) {
    this.stack.push(matchers)
    this.indices.push(0)
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

  const iter = new MatcherIterator()
  iter.push(children)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const matcher = iter.next()
    if (!matcher) break

    const match = matcher.match(entry, options)
    if (match === 'none') continue
    if (Array.isArray(match)) {
      assert(matcher.children.length)
      next.children.push(...matcher.children)
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

      continue
    }

    if (match.down) {
      next.children.push(...match.down)
    }
    if (match.recur) {
      iter.push(matcher.children)
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
    next.children.length &&
    entry instanceof LazyDir &&
    !next.children.every((m) => m.negating)
  ) {
    matchInDir(entry, options, next.children, result)
  }

  relinquishNextChildren(next)

  return result
}
