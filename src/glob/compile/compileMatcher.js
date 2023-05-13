import assert from 'assert'
import { isAbsolute } from '../../path.js'
import { ExactStringMatcher } from '../matchers/ExactStringMatcher.js'
import { RecursiveWildcardMatcher } from '../matchers/RecursiveWildcardMatcher.js'
import { RegExpMatcher } from '../matchers/RegExpMatcher.js'
import { RootMatcher } from '../matchers/RootMatcher.js'
import { WildcardMatcher } from '../matchers/WildcardMatcher.js'
import { Parser } from './Parser.js'
import { expandBraces } from './expandBraces.js'

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
 * @param {Expression[]} segment
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

  assert(segment.length > 0)
  const only = segment.length > 1 ? null : segment[0]

  if (only?.type === 'recursive_wildcard') {
    return make(
      (m) => m instanceof RecursiveWildcardMatcher,
      () => new RecursiveWildcardMatcher(negating),
    )
  }

  if (only?.type === 'wildcard') {
    return make(
      (m) => m instanceof WildcardMatcher,
      () => new WildcardMatcher(negating),
    )
  }

  // match a boring file/dir name that does not require any regex stuff
  if (only?.type === 'string') {
    return make(
      (m) => m instanceof ExactStringMatcher && m.pattern === only.value,
      () => new ExactStringMatcher(only.value, negating),
    )
  }

  // Fall back to a regex matcher

  const source = compileRegexSourceFromSegment(segment, opts, negating)

  return make(
    (m) => m instanceof RegExpMatcher && m.source === source,
    () => new RegExpMatcher(source, new RegExp(source), negating),
  )
}

/**
 * @param {string} pattern
 * @returns {Expression[][]}
 */
function parsePattern(pattern) {
  return expandBraces(new Parser(pattern).parseSequence())
}

/**
 * @param {MatchOptions} opts
 * @param {string[]} patterns
 * @param {string} rootDir
 */
export function compileMatcher(opts, patterns, rootDir) {
  let cwd = opts.cwd
  assert(isAbsolute(cwd))
  assert(isAbsolute(rootDir))

  // replace `c:/` on windows with just `/`
  if (cwd !== '/' && cwd.startsWith(rootDir)) {
    cwd = cwd.replace(rootDir, '/')
  }

  const root = new RootMatcher()

  /**
   * @param {MatchOptions} opts
   * @param {Expression[]} path
   * @param {boolean} negating
   */
  function addSegments(opts, path, negating) {
    assert(path.length !== 0)
    /** @type {Expression[]} */
    let nextSegment = []
    let prev = root
    for (let i = 0; i < path.length; i++) {
      const expr = path[i]
      if (expr.type === 'separator') {
        if (nextSegment.length > 0) {
          prev = compilePathSegment(opts, prev, nextSegment, negating, false)
          nextSegment = []
        }
      } else {
        nextSegment.push(expr)
      }
    }
    // we would always expect the nextSegment to be nonempty unless the path is empty or ends in a forward slash
    // (which should never happen because we check for that above)
    assert(nextSegment.length > 0)
    prev = compilePathSegment(opts, prev, nextSegment, negating, true)
  }

  const cwdPath = parsePattern(cwd)[0]

  const firstIsNegating = patterns[0]?.startsWith('!')
  if (firstIsNegating) {
    patterns = ['**/*', ...patterns]
  }
  for (let pattern of patterns) {
    const negating = pattern.startsWith('!')
    if (negating) {
      pattern = pattern.slice(1)
    }
    for (let path of parsePattern(pattern)) {
      // make sure the pattern is absolute
      if (path[0].type !== 'separator') {
        path = [...cwdPath, { type: 'separator', start: 0, end: 0 }, ...path]
      }
      addSegments(opts, path, negating)
    }
  }

  return root
}

/**
 * @param {Expression[]} segment
 * @param {MatchOptions} opts
 * @param {boolean} negating
 * @returns {string}
 */
function compileRegexSourceFromSegment(segment, opts, negating) {
  let source = '^'
  if (!(opts.dot || negating)) {
    source += '(?!\\.)'
  }
  for (const expr of segment) {
    source += compileRegexSourceFromExpression(expr, opts, negating)
  }

  return source + '$'
}

/**
 * @param {Expression} expr
 * @param {MatchOptions} opts
 * @param {boolean} negating
 * @returns {string}
 */
function compileRegexSourceFromExpression(expr, opts, negating) {
  switch (expr.type) {
    case 'range_expansion': {
      const start = Math.min(expr.startNumber, expr.endNumber)
      const end = Math.max(expr.startNumber, expr.endNumber)
      const step = expr.step || 1
      const pad = expr.pad
      if (start === end) {
        return ''
      }
      const numbers = new Array(Math.ceil((end - start) / step))
      for (let i = start; i < end; i += step) {
        numbers.push(i.toString().padStart(pad, '0'))
      }
      return `(${numbers.join('|')})`
    }
    case 'recursive_wildcard':
    case 'wildcard':
      return '.*'
    case 'string':
      // replace all non-word characters with escaped versions
      return expr.value.replaceAll(/[^\w-]/g, (c) =>
        c === '.' ? '\\.' : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
      )
    case 'parens': {
      assert(expr.extGlobPrefix !== null)
      const options = expr.options
        .map((o) => compileRegexSourceFromExpression(o, opts, negating))
        .join('|')
      switch (expr.extGlobPrefix) {
        case '!':
          return `(?!${options})`
        case '*':
          return `(${options})*`
        case '+':
          return `(${options})+`
        case '?':
          return `(${options})?`
        case '@':
          return `(${options})`
        default:
          throw new Error(`Unexpected extglob prefix: ${expr.extGlobPrefix}`)
      }
    }
    case 'character_class': {
      let out = '['
      if (expr.negating) {
        out += '^'
      }
      for (const inclusion of expr.inclusions) {
        if (inclusion.type === 'character_class_builtin') {
          out += getBuiltinClass(inclusion.class)
        } else if (inclusion.type === 'character_class_range') {
          out += `${printCharForCharacterClass(inclusion.startChar)}-${printCharForCharacterClass(
            inclusion.endChar,
          )}`
        } else {
          out += printCharForCharacterClass(inclusion.char)
        }
      }
      return out + ']'
    }

    default: {
      throw new Error(`Unexpected expression type: ${expr.type}`)
    }
  }
}

/**
 * @param {string} char
 */
function printCharForCharacterClass(char) {
  if (/[\w.?,'"$£@!%&*()]/.test(char)) {
    return char
  } else {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  }
}

/** @param {CharacterClassBuiltinClass['class']} name */
function getBuiltinClass(name) {
  switch (name) {
    case 'alnum':
      return '0-9A-Za-z'
    case 'alpha':
      return 'A-Za-z'
    case 'ascii':
      return '\\x00-\\x7F'
    case 'blank':
      return ' \\t'
    case 'cntrl':
      return '\\x00-\\x1F\\x7F'
    case 'digit':
      return '0-9'
    case 'graph':
      return '\\x21-\\x7E'
    case 'lower':
      return 'a-z'
    case 'print':
      return '\\x20-\\x7E'
    case 'punct':
      return `!"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_\`{|}~`
    case 'space':
      return '\\S'
    case 'upper':
      return 'A-Z'
    case 'word':
      return '\\w'
    case 'xdigit':
      return '0-9A-Fa-f'
    case 'not_word':
      return '\\W'
    case 'not_digit':
      return '\\D'
    case 'not_space':
      return '\\S'
    default:
      throw new Error(`Unexpected builtin class: ${name}`)
  }
}
