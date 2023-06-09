import assert from 'assert'
import { isAbsolute } from '../../path.js'
import { Parser } from './Parser.js'
import { expandBraces, segmentize } from './expandBraces.js'
import {
  makeRegexpMatchFn,
  makeStringMatchFn,
  matcher,
  oneCharMatchFn,
  recursiveWildcardMatchFn,
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
    return matcher(only.value, negating, makeStringMatchFn(only.value))
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
 * @param {string} pattern
 * @returns {boolean}
 */
export function isNegating(pattern) {
  return pattern.startsWith('!') && !pattern.startsWith('!(')
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
    .map((s) => [{ type: 'string', source: '', value: s, start: 0, end: 0 }])

  const firstIsNegating = isNegating(patterns[0])
  if (firstIsNegating) {
    patterns = ['**/*', ...patterns]
  }

  return patterns.reverse().flatMap((pattern) => {
    const negating = isNegating(pattern)
    if (negating) {
      pattern = pattern.slice(1)
    }
    if (pattern.startsWith(rootDir)) {
      pattern = '/' + pattern.slice(rootDir.length)
    }
    return parsePattern(pattern).map((path) => {
      const { segments } = segmentize(path, cwdPath)
      const matchers = segments.map((segment) => compilePathSegment(opts, segment, negating))
      return stitchMatchers(matchers)
    })
  })
}

/**
 * @param {Matcher[]} matchers
 * @returns {Matcher}
 */
function stitchMatchers(matchers) {
  for (let i = 0; i < matchers.length - 1; i++) {
    matchers[i].next = matchers[i + 1]
  }
  return matchers[0]
}

/**
 * @param {Expression[]} segment
 * @param {MatchOptions} opts
 * @param {boolean} negating
 * @returns {string}
 */
function compileRegexSourceFromSegment(segment, opts, negating) {
  let source = '^'
  for (let i = 0; i < segment.length; i++) {
    const expr = segment[i]
    source += compileRegexSourceFromExpression(expr, opts, negating, i === segment.length - 1)
  }
  return source + '$'
}

/**
 * @param {Expression} expr
 * @param {MatchOptions} opts
 * @param {boolean} negating
 * @param {boolean} isLast
 * @returns {string}
 */
function compileRegexSourceFromExpression(expr, opts, negating, isLast) {
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
        .map((o) =>
          compileRegexSourceFromExpression(o, opts, negating || expr.extGlobPrefix === '!', isLast),
        )
        .join('|')
      switch (expr.extGlobPrefix) {
        case '!':
          if (opts.dot) {
            return isLast ? `(?!(${options})$).*` : `(?!${options}).*`
          } else {
            return isLast ? `(?:(?!^\\.)(?!(${options})$).*)` : `(?:(?!^\\.)(?!${options}).*)`
          }
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
    case 'sequence': {
      let out = ''
      for (let i = 0; i < expr.expressions.length; i++) {
        const child = expr.expressions[i]
        out += compileRegexSourceFromExpression(
          child,
          opts,
          negating,
          isLast && i === expr.expressions.length - 1,
        )
      }
      return out
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
