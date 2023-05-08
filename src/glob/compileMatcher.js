import micromatch from 'micromatch'
import { isAbsolute, join, normalize } from 'path'
import { convertParens } from '../manifest/convertParens.js'
import { ExactStringMatcher } from './matchers/ExactStringMatcher.js'
import { RecursiveWildcardMatcher } from './matchers/RecursiveWildcardMatcher.js'
import { RegExpMatcher } from './matchers/RegExpMatcher.js'
import { RootMatcher } from './matchers/RootMatcher.js'
import { WildcardMatcher } from './matchers/WildcardMatcher.js'

/**
 * Finds a matcher in an existing list of children that does the same thing as a new matcher.
 * If it is we can combine the two to build a more efficient tree structure.
 * @param {Matcher[]} children
 * @param {boolean} negating
 * @param {boolean} terminal
 * @param {(m: Matcher) => boolean} pred
 */
function findSimpaticoMatcher(children, negating, terminal, pred) {
  for (
    let i = children.length - 1;
    i >= 0 && children[i].negating === negating && terminal === !children[i].children.length;
    i--
  ) {
    const matcher = children[i]
    if (pred(matcher)) {
      return matcher
    }
  }
  return null
}

/**
 * @param {MatchOptions} opts
 * @param {Matcher} prev
 * @param {string} segment
 * @param {boolean} negating
 * @param {boolean} terminal
 * @returns {Matcher}
 */
function compilePathSegment(opts, prev, segment, negating, terminal) {
  /**
   * Try to find a simpatico matcher in the existing children.
   * If none is found, create a new one using the given constructor.
   * @param {(m: Matcher) => boolean} simpaticoPred
   * @param {() => Matcher} ctor
   */
  const make = (simpaticoPred, ctor) => {
    const existing = findSimpaticoMatcher(prev.children, negating, terminal, simpaticoPred)
    if (existing) return existing
    const matcher = ctor()
    prev.children.push(matcher)
    return matcher
  }

  if (segment === '**') {
    return make(
      (m) => m instanceof RecursiveWildcardMatcher,
      () => new RecursiveWildcardMatcher(negating),
    )
  }

  if (segment === '*') {
    return make(
      (m) => m instanceof WildcardMatcher,
      () => new WildcardMatcher(negating),
    )
  }

  // match a boring file/dir name that does not require any regex stuff
  if (/^[\w-.]+$/.test(segment)) {
    return make(
      (m) => m instanceof ExactStringMatcher && m.pattern === segment,
      () => new ExactStringMatcher(segment, negating),
    )
  }

  // Fall back to a regex matcher, compiled by micromatch
  return make(
    (m) => m instanceof RegExpMatcher && m.source === segment,
    () =>
      new RegExpMatcher(
        segment,
        micromatch.makeRe(segment, { dot: opts.dot || negating }),
        negating,
      ),
  )
}

/**
 * @param {MatchOptions} opts
 * @param {string[]} patterns
 * @param {string} cwd
 */
export function compileMatcher(opts, patterns, cwd) {
  const root = new RootMatcher()

  /**
   * @param {MatchOptions} opts
   * @param {string[]} segments
   * @param {boolean} negating
   */
  function addSegments(opts, segments, negating) {
    let prev = root
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      prev = compilePathSegment(opts, prev, segment, negating, i === segments.length - 1)
    }
  }

  let wasFirst = true
  for (let expansion of patterns
    .map(
      (pattern) => micromatch.braces(convertParens(pattern), { expand: true }),
      // flatMap doesn't work here because if the string doesn't need expanding it returns a string
      // and then the strings get concatenated for some reason.
    )
    .flat()) {
    const isFirst = wasFirst
    wasFirst = false
    let negating = false
    if (expansion.startsWith('!')) {
      expansion = expansion.slice(1)
      negating = true
      if (isFirst) {
        // negating the first matcher implies a "**/*" above it
        addSegments(opts, [...cwd.split('/').filter(Boolean), '**', '*'], false)
      }
    }
    if (!isAbsolute(expansion)) {
      expansion = join(cwd, expansion)
    }
    expansion = normalize(expansion)
    const segments = expansion.split('/').filter(Boolean)
    if (segments.length === 0) {
      continue
    }

    addSegments(opts, segments, negating)
  }

  return root
}
