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
   * @returns {Sequence}
   * @param {symbol[]} [stoppingTokens]
   */
  parseSequence(stoppingTokens) {
    /** @type {Expression[]} */
    const expressions = []
    while (this.lex.hasMoreTokens()) {
      if (stoppingTokens?.includes(/** @type {any} */ (this.lex.peek()))) {
        break
      }
      expressions.push(this.parseExpression())
    }
    return {
      type: 'sequence',
      start: 0,
      end: this.lex.index,
      expressions: expressions,
    }
  }

  /** @returns {Expression} */
  parseExpression() {
    const start = this.lex.index
    const peek = this.lex.peek()
    if (typeof peek === 'string') {
      this.lex.nextToken()
      return {
        type: 'string',
        value: peek,
        end: this.lex.index,
        start: start,
      }
    } else if (peek === EXCLAMATION) {
      this.lex.nextToken()
      if (!this.lex.hasMoreTokens()) {
        throw this.err('Invalid negation', start)
      }
      if (this.lex.peek() === OPEN_PAREN) {
        return this.parseParens('!')
      }
      return {
        type: 'negated_expression',
        expression: this.parseExpression(),
        start,
        end: this.lex.index,
      }
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
      return {
        type: 'string',
        value: '+',
        start: start,
        end: this.lex.index,
      }
    } else if (peek === AT) {
      this.lex.nextToken()
      if (this.lex.peek() === OPEN_PAREN) {
        return this.parseParens('@')
      }
      return {
        type: 'string',
        value: '@',
        start: start,
        end: this.lex.index,
      }
    } else if (peek === OPEN_BRACE) {
      return this.parseBraces()
    } else if (peek === OPEN_PAREN) {
      return this.parseParens(null)
    } else {
      this.lex.nextToken()
      return {
        type: 'string',
        value: peek.description ?? '',
        end: this.lex.index,
        start: start,
      }
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
    const start = this.lex.index
    assert(this.lex.nextToken() === OPEN_PAREN)

    /**
     * @type {Expression[]}
     */
    const options = []

    while (this.lex.hasMoreTokens() && this.lex.peek() !== CLOSE_PAREN) {
      options.push(this.parseSequence([PIPE, CLOSE_PAREN]))
      if (this.lex.peek() === PIPE) {
        this.lex.nextToken()
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
      return {
        type: 'range_expansion',
        start: start,
        end: this.lex.index,
        startNumber: Number(next.replace(/^0*/, '')),
        endNumber: end,
        pad: numLeadingZeroes(next),
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
