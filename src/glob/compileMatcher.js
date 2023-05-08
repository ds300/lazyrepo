import micromatch from 'micromatch'
import { isAbsolute, join, normalize } from 'path'
import { ExactStringMatcher } from './matchers/ExactStringMatcher.js'
import { RecursiveWildcardMatcher } from './matchers/RecursiveWildcardMatcher.js'
import { RegExpMatcher } from './matchers/RegExpMatcher.js'
import { RootMatcher } from './matchers/RootMatcher.js'
import { WildcardMatcher } from './matchers/WildcardMatcher.js'

/**
 *
 * @param {Matcher[]} next
 * @param {boolean} negating
 * @param {boolean} terminal
 * @param {(m: Matcher) => boolean} pred
 */
function findSimpaticoMatcher(next, negating, terminal, pred) {
  for (
    let i = next.length - 1;
    i >= 0 && next[i].negating === negating && terminal === !next[i].next.length;
    i--
  ) {
    const matcher = next[i]
    if (pred(matcher)) {
      return matcher
    }
  }
  return null
}

/**
 *
 * @param {MatchOptions} opts
 * @param {Matcher} prev
 * @param {string} segment
 * @param {boolean} negating
 * @param {boolean} terminal
 * @returns {Matcher}
 */
function compilePathSegment(opts, prev, segment, negating, terminal) {
  if (segment === '**') {
    const existing = findSimpaticoMatcher(
      prev.next,
      negating,
      terminal,
      (m) => m instanceof RecursiveWildcardMatcher,
    )
    if (existing) return existing
    const matcher = new RecursiveWildcardMatcher(negating)
    prev.next.push(matcher)
    return matcher
  }
  if (segment === '*') {
    const existing = findSimpaticoMatcher(
      prev.next,
      negating,
      terminal,
      (m) => m instanceof WildcardMatcher,
    )
    if (existing) return existing
    const matcher = new WildcardMatcher(negating)
    prev.next.push(matcher)
    return matcher
  }
  if (/^[\w-.]+$/.test(segment)) {
    const existing = findSimpaticoMatcher(
      prev.next,
      negating,
      terminal,
      (m) => m instanceof ExactStringMatcher && m.pattern === segment,
    )
    if (existing) return existing
    const matcher = new ExactStringMatcher(segment, negating)
    prev.next.push(matcher)
    return matcher
  }

  const existing = findSimpaticoMatcher(
    prev.next,
    negating,
    terminal,
    (m) => m instanceof RegExpMatcher && m.source === segment,
  )
  if (existing) return existing

  const regex = micromatch.makeRe(segment, { dot: opts.dot || negating })
  const matcher = new RegExpMatcher(segment, regex, negating)
  prev.next.push(matcher)
  return matcher
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
      (pattern) => micromatch.braces(pattern, { expand: true }),
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
    if (expansion.includes('\\')) {
      expansion = expansion.replace(/\\/g, '/')
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
