import assert from 'assert'
import {
  AT,
  CLOSE_BRACE,
  CLOSE_PAREN,
  COMMA,
  DOT_DOT,
  EXCLAMATION,
  Lexer,
  OPEN_BRACE,
  OPEN_PAREN,
  PIPE,
  PLUS,
  QUESTION,
  SLASH,
  STAR,
} from './Lexer.js'

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
    } else if (peek === SLASH) {
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

    if (typeof next === 'string' && next.match(/^\d+$/) && this.lex.peek() === DOT_DOT) {
      // this is a range
      this.lex.nextToken()
      const midOrEnd = this.lex.nextToken()
      if (typeof midOrEnd !== 'string' || !midOrEnd.match(/^\d+$/)) {
        throw this.err('Invalid range', start)
      }
      let end = Number(midOrEnd.replace(/^0*/, ''))
      let step = 1
      if (this.lex.peek() === DOT_DOT) {
        this.lex.nextToken()
        const endToken = this.lex.nextToken()
        if (typeof endToken !== 'string' || !endToken.match(/^\d+$/)) {
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
  return str.match(/^0*/)?.[0].length ?? 0
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
