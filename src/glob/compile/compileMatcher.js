import assert from 'assert'
import { isAbsolute } from '../../path.js'
import { Parser } from './Parser.js'
import { expandBraces, segmentize } from './expandBraces.js'
import {
  makeRegexpMatchFn,
  matcher,
  oneCharMatchFn,
  recursiveWildcardMatchFn,
  upMatchFn,
  wildcardMatchFn,
} from './matcher.js'

/**
 * @param {MatchOptions} opts
 * @param {Expression[]} segment
 * @param {boolean} negating
 * @returns {Matcher}
 */
function compilePathSegment(opts, segment, negating) {
  /**
   * Try to find a simpatico matcher in the existing children.
   * If none is found, create a new one using the given constructor.
   * @param {(m: Matcher) => boolean} simpaticoPred
   * @param {() => Matcher} ctor
   */

  assert(segment.length > 0)
  const only = segment.length > 1 ? null : segment[0]

  if (only?.type === 'recursive_wildcard') {
    return matcher('**', negating, recursiveWildcardMatchFn)
  }

  if (only?.type === 'wildcard') {
    if (only.wildcardType === '*') {
      return matcher('*', negating, wildcardMatchFn)
    } else {
      return matcher('?', negating, oneCharMatchFn)
    }
  }

  // match a boring file/dir name that does not require any regex stuff
  if (only?.type === 'string') {
    if (only.value === '..') {
      return matcher('..', negating, upMatchFn)
    }
  }

  // Fall back to a regex matcher

  const source = compileRegexSourceFromSegment(segment, opts, negating)
  return matcher(source, negating, makeRegexpMatchFn(new RegExp(source)))
}

/**
 * @param {string} pattern
 * @returns {Expression[][]}
 */
function parsePattern(pattern) {
  return expandBraces(new Parser(pattern.replaceAll(/(\*\*\/)+/g, '**/')).parseSequence())
}

/**
 * @param {MatchOptions} opts
 * @param {string[]} patterns
 * @param {string} rootDir
 * @returns {Matcher[]}
 */
export function compileMatcher(opts, patterns, rootDir) {
  let cwd = opts.cwd
  assert(isAbsolute(cwd))
  assert(isAbsolute(rootDir))

  // replace `c:/` on windows with just `/`
  if (cwd !== '/' && cwd.startsWith(rootDir)) {
    cwd = cwd.replace(rootDir, '/')
  }

  /** @type {Expression[][]} */
  const cwdPath = cwd
    .split('/')
    .filter(Boolean)
    .map((s) => [{ type: 'string', value: s, start: 0, end: 0 }])

  const firstIsNegating = patterns[0]?.startsWith('!')
  if (firstIsNegating) {
    patterns = ['**/*', ...patterns]
  }

  return patterns.reverse().flatMap((pattern) => {
    const negating = pattern.startsWith('!')
    if (negating) {
      pattern = pattern.slice(1)
    }
    return parsePattern(pattern).map((path) => {
      const parts = segmentize(path, cwdPath)
      const root = compilePathSegment(opts, parts[0], negating)
      let prev = root
      for (let i = 1; i < parts.length; i++) {
        const segment = parts[i]
        const next = compilePathSegment(opts, segment, negating)
        prev.next = next
        prev = next
      }
      return root
    })
  })
}

/**
 * @param {Expression[]} segment
 * @param {MatchOptions} opts
 * @param {boolean} negating
 * @returns {string}
 */
function compileRegexSourceFromSegment(segment, opts, negating) {
  let source = '^'
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
      if (expr.type === 'wildcard' && expr.wildcardType === '?') {
        return opts.dot || negating ? '.' : '(?:(?=^)[^.]|(?!^).)'
      }
      return opts.dot || negating ? '.*' : '(?:(?!^\\.).*)'
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
          return `(?!${options}).*`
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
