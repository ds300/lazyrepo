import assert from 'assert'
import {
  AT,
  BACK_SLASH,
  CARET,
  CLOSE_BRACE,
  CLOSE_BRACKET,
  CLOSE_PAREN,
  COMMA,
  DOT_DOT,
  EXCLAMATION,
  FORWARD_SLASH,
  Lexer,
  OPEN_BRACE,
  OPEN_BRACKET,
  OPEN_PAREN,
  PIPE,
  PLUS,
  QUESTION,
  STAR,
} from './Lexer.js'

const DIGITS = /^\d+$/

const posixClasses = /** @type {const} */ ({
  ':alnum:': 'alnum',
  ':alpha:': 'alpha',
  ':ascii:': 'ascii',
  ':blank:': 'blank',
  ':cntrl:': 'cntrl',
  ':digit:': 'digit',
  ':graph:': 'graph',
  ':lower:': 'lower',
  ':print:': 'print',
  ':punct:': 'punct',
  ':space:': 'space',
  ':upper:': 'upper',
  ':word:': 'word',
  ':xdigit:': 'xdigit',
})

export class ParserError extends Error {
  /**
   * @param {string} msg
   * @param {number} start
   * @param {number} end
   * @param {string} pattern
   */
  constructor(msg, start, end, pattern) {
    super(msg)
    this.start = start
    this.end = end
    this.pattern = pattern
  }
}

export class Parser {
  /**
   * @param {string} pattern
   */
  constructor(pattern) {
    this.lex = new Lexer(pattern)
  }

  /**
   * @returns {Expression}
   * @param {symbol[]} [stoppingTokens]
   * @param {boolean} [isExtGlobMode]
   */
  parseSequence(stoppingTokens, isExtGlobMode) {
    /** @type {Expression[]} */
    const expressions = []
    const start = this.lex.index
    while (this.lex.hasMoreTokens()) {
      if (stoppingTokens?.includes(/** @type {any} */ (this.lex.peek()))) {
        break
      }
      const nextExpression = this.parseExpression(isExtGlobMode)
      const lastExpression = expressions.at(-1)
      if (nextExpression.type === 'string' && lastExpression?.type === 'string') {
        lastExpression.value += nextExpression.value
        lastExpression.end = nextExpression.end
      } else {
        expressions.push(nextExpression)
      }
    }
    if (expressions.length === 0) {
      return string('', start, this.lex.index)
    }
    if (expressions.length === 1) {
      return expressions[0]
    }
    return {
      type: 'sequence',
      start,
      end: this.lex.index,
      expressions: expressions,
    }
  }

  /**
   * @returns {Expression}
   * @param {boolean} [isExtGlobMode]
   */
  parseExpression(isExtGlobMode) {
    const start = this.lex.index
    const peek = this.lex.peek()
    if (typeof peek === 'string') {
      this.lex.nextToken()
      return string(peek, start, this.lex.index)
    } else if (peek === EXCLAMATION) {
      this.lex.nextToken()
      if (!this.lex.hasMoreTokens()) {
        throw this.err('Invalid negation', start)
      }
      if (this.lex.peek() !== OPEN_PAREN) {
        throw this.err('"!" must be followed by "(" e.g. "src/!(foo)/bar"', start)
      }
      return this.parseParens('!')
    } else if (peek === STAR) {
      this.lex.nextToken()
      if (this.lex.peek() === STAR) {
        this.lex.nextToken()
        return {
          type: 'recursive_wildcard',
          start: start,
          end: this.lex.index,
        }
      }
      if (this.lex.peek() === OPEN_PAREN) {
        return this.parseParens('*')
      }
      return {
        type: 'wildcard',
        wildcardType: '*',
        start: start,
        end: this.lex.index,
      }
    } else if (peek === QUESTION) {
      this.lex.nextToken()
      if (this.lex.peek() === OPEN_PAREN) {
        return this.parseParens('?')
      }
      return {
        type: 'wildcard',
        wildcardType: '?',
        start: start,
        end: this.lex.index,
      }
    } else if (peek === FORWARD_SLASH) {
      this.lex.nextToken()
      if (isExtGlobMode) {
        this.err('"/" is not allowed in extglob expressions', start)
      }
      return {
        type: 'separator',
        end: this.lex.index,
        start: start,
      }
    } else if (peek === PLUS) {
      this.lex.nextToken()
      if (this.lex.peek() === OPEN_PAREN) {
        return this.parseParens('+')
      }
      return string('+', start, this.lex.index)
    } else if (peek === AT) {
      this.lex.nextToken()
      if (this.lex.peek() === OPEN_PAREN) {
        return this.parseParens('@')
      }
      return string('@', start, this.lex.index)
    } else if (peek === OPEN_BRACE) {
      if (isExtGlobMode) {
        this.err('"{" is not allowed in extglob expressions', start)
      }
      return this.parseBraces()
    } else if (peek === OPEN_PAREN) {
      return this.parseParens(isExtGlobMode ? '+' : null)
    } else if (peek === OPEN_BRACKET) {
      return this.parseCharacterClass()
    } else {
      this.lex.nextToken()
      return string(peek.description ?? '', start, this.lex.index)
    }
  }

  /**
   * @param {string} msg
   * @param {number} start
   * @param {number} [end]
   */
  err(msg, start, end = this.lex.index) {
    throw new ParserError(msg, start, end, this.lex.pattern)
  }

  /**
   * @returns {CharacterClass}
   */
  parseCharacterClass() {
    const start = this.lex.index
    assert(this.lex.nextToken(false) === OPEN_BRACKET)
    const negating = this.lex.peek(false) === CARET
    if (negating) {
      this.lex.nextToken(false)
    }
    /** @type {CharacterClassElement[]} */
    const inclusions = []
    while (this.lex.hasMoreTokens() && this.lex.peek(false) !== CLOSE_BRACKET) {
      inclusions.push(this.parseCharacterClassElement())
    }
    if (this.lex.peek(false) !== CLOSE_BRACKET) {
      throw this.err('Unterminated character class', start)
    }
    this.lex.nextToken(false)
    return {
      type: 'character_class',
      start: start,
      end: this.lex.index,
      negating,
      inclusions,
    }
  }

  /** @returns {CharacterClassElement} */
  parseCharacterClassElement() {
    const start = this.lex.index
    const next = this.parseCharacterClassChar()
    if (typeof next === 'object') {
      return next
    }
    if (this.lex.peek(false) !== '-') {
      return characterLiteral(next, start, this.lex.index)
    }
    this.lex.nextToken(false)
    if (!this.lex.hasMoreTokens()) {
      throw this.err('Unterminated character class', start)
    }
    if (this.lex.peek(false) === ']') {
      return characterLiteral('-', start, this.lex.index)
    }
    const end = this.parseCharacterClassChar()
    if (typeof end === 'object') {
      return characterLiteral('-', start, this.lex.index)
    }
    return {
      type: 'character_class_range',
      start: start,
      end: this.lex.index,
      startChar: next,
      endChar: end,
    }
  }

  /**
   * @returns {CharacterClassElement | string}
   */
  parseCharacterClassChar() {
    const start = this.lex.index
    const char = this.lex.nextToken(false)
    if (!this.lex.hasMoreTokens()) {
      throw this.err('Unterminated character class', start)
    }

    if (char === OPEN_BRACKET) {
      const className = this.lex.nextToken(true)
      if (
        typeof className !== 'string' ||
        !posixClasses[/** @type {keyof typeof posixClasses} */ (className)]
      ) {
        throw this.err('Invalid character class', start)
      }
      assert(this.lex.nextToken(false) === CLOSE_BRACKET)
      return {
        type: 'character_class_builtin',
        class: posixClasses[/** @type {keyof typeof posixClasses} */ (className)],
        start,
        end: this.lex.index,
      }
    }

    if (char !== BACK_SLASH) {
      return asString(char)
    }

    if (!this.lex.hasMoreTokens()) {
      throw this.err('Unterminated character class', start)
    }
    const next = this.lex.nextToken(false)
    if (typeof next === 'string') {
      if (next === 'w') {
        return builtinClass('word', start, this.lex.index)
      } else if (next === 'W') {
        return builtinClass('not_word', start, this.lex.index)
      } else if (next === 'd') {
        return builtinClass('digit', start, this.lex.index)
      } else if (next === 'D') {
        return builtinClass('not_digit', start, this.lex.index)
      } else if (next === 's') {
        return builtinClass('space', start, this.lex.index)
      } else if (next === 'S') {
        return builtinClass('not_space', start, this.lex.index)
      }
    }
    return asString(next)
  }

  /**
   * @returns {Braces | RangeExpansion}
   */
  parseBraces() {
    const start = this.lex.index
    assert(this.lex.nextToken() === OPEN_BRACE)

    /**
     * @type {BraceExpression[]}
     */
    const options = []

    while (this.lex.hasMoreTokens() && this.lex.peek() !== CLOSE_BRACE) {
      options.push(this.parseBraceExpression())
      if (this.lex.peek() === COMMA) {
        this.lex.nextToken()
        if (this.lex.peek() === CLOSE_BRACE) {
          options.push(string('', this.lex.index, this.lex.index))
        }
      }
    }

    if (this.lex.peek() !== CLOSE_BRACE) {
      throw this.err('Unterminated brace expression', start)
    }
    this.lex.nextToken()

    return {
      type: 'braces',
      start: start,
      end: this.lex.index,
      options,
    }
  }

  /**
   * @param {'*' | '@' | '+' | '!' | '?' | null} extGlobPrefix
   * @returns {Parens}
   */
  parseParens(extGlobPrefix) {
    const start = extGlobPrefix ? this.lex.index - 1 : this.lex.index
    assert(this.lex.nextToken() === OPEN_PAREN)

    /**
     * @type {Expression[]}
     */
    const options = []

    while (this.lex.hasMoreTokens() && this.lex.peek() !== CLOSE_PAREN) {
      options.push(this.parseSequence([PIPE, CLOSE_PAREN], !!extGlobPrefix))
      if (this.lex.peek() === PIPE) {
        this.lex.nextToken()
        if (this.lex.peek() === CLOSE_PAREN) {
          options.push(string('', this.lex.index, this.lex.index))
        }
      }
    }

    if (this.lex.peek() !== CLOSE_PAREN) {
      throw this.err('Unterminated paren expression', start)
    }
    this.lex.nextToken()

    return {
      type: 'parens',
      start: start,
      end: this.lex.index,
      options,
      extGlobPrefix,
    }
  }

  /**
   * @returns {BraceExpression}
   */
  parseBraceExpression() {
    const start = this.lex.index
    const next = this.lex.nextToken()

    if (typeof next === 'string' && DIGITS.test(next) && this.lex.peek() === DOT_DOT) {
      // this is a range
      this.lex.nextToken()
      const midOrEnd = this.lex.nextToken()
      if (typeof midOrEnd !== 'string' || !DIGITS.test(midOrEnd)) {
        throw this.err('Invalid range', start)
      }
      let end = Number(midOrEnd.replace(/^0*/, ''))
      let step = 1
      if (this.lex.peek() === DOT_DOT) {
        this.lex.nextToken()
        const endToken = this.lex.nextToken()
        if (typeof endToken !== 'string' || !DIGITS.test(endToken)) {
          throw this.err('Invalid range', start)
        }
        step = end
        end = Number(stripLeadingZeroes(endToken))
      }
      const numZeros = numLeadingZeroes(next)
      const pad = numZeros > 0 ? numZeros + next.length : 0
      return {
        type: 'range_expansion',
        start: start,
        end: this.lex.index,
        startNumber: Number(next.replace(/^0*/, '')),
        endNumber: end,
        pad,
        step,
      }
    }

    this.lex.stash(next, start)
    return this.parseSequence([COMMA, CLOSE_BRACE])
  }
}

/** @param {string} str */
function numLeadingZeroes(str) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== '0') {
      return i
    }
  }
  return str.length
}

/** @param {string} str */
function stripLeadingZeroes(str) {
  return str.replace(/^0*/, '')
}

/**
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {StringNode}
 */
function string(value, start, end) {
  return {
    type: 'string',
    value,
    start,
    end,
  }
}

/**
 * @param {CharacterClassBuiltinClass['class']} name
 * @param {number} start
 * @param {number} end
 * @returns {CharacterClassBuiltinClass}
 */
function builtinClass(name, start, end) {
  return {
    type: 'character_class_builtin',
    class: name,
    start,
    end,
  }
}

/**
 * @param {string} char
 * @param {number} start
 * @param {number} end
 * @returns {CharacterClassElementLiteral}
 */
function characterLiteral(char, start, end) {
  return {
    type: 'character_class_element_literal',
    char,
    start,
    end,
  }
}

/**
 * @param {string | symbol} value
 */
function asString(value) {
  return typeof value === 'string' ? value : value.description ?? ''
}
