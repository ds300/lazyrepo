import assert from 'assert'

export const OPEN_PAREN = Symbol('(')
export const CLOSE_PAREN = Symbol(')')
export const PIPE = Symbol('|')
export const STAR = Symbol('*')
export const QUESTION = Symbol('?')
export const PLUS = Symbol('+')
export const DOT = Symbol('.')
export const DOT_DOT = Symbol('..')
export const FORWARD_SLASH = Symbol('/')
export const BACK_SLASH = Symbol('\\')
export const OPEN_BRACKET = Symbol('[')
export const CLOSE_BRACKET = Symbol(']')
export const EXCLAMATION = Symbol('!')
export const OPEN_BRACE = Symbol('{')
export const CLOSE_BRACE = Symbol('}')
export const COMMA = Symbol(',')
export const AT = Symbol('@')
export const CARET = Symbol('^')

const escapableSymbolsRegex = /[()|*?+@[\]!{}\\,]/

const stringToSymbol = {
  '(': OPEN_PAREN,
  ')': CLOSE_PAREN,
  '|': PIPE,
  '*': STAR,
  '?': QUESTION,
  '+': PLUS,
  '.': DOT,
  '..': DOT_DOT,
  '\\': BACK_SLASH,
  '/': FORWARD_SLASH,
  '[': OPEN_BRACKET,
  ']': CLOSE_BRACKET,
  '!': EXCLAMATION,
  '{': OPEN_BRACE,
  '}': CLOSE_BRACE,
  ',': COMMA,
  '@': AT,
  '^': CARET,
}

export class Lexer {
  /**
   * @type {string}
   * @readonly
   */
  pattern

  /**
   * @param {string} pattern
   */
  constructor(pattern) {
    this.pattern = pattern
  }

  #index = 0

  /** @type {string | symbol | null} */
  #stashedToken = null
  #stashedTokenIndex = 0
  /** @type {string | symbol | null} */
  #peekingToken = null
  #nonPeekingTokenIndex = 0

  get index() {
    if (this.#stashedToken !== null) {
      return this.#stashedTokenIndex
    }
    if (this.#peekingToken !== null) {
      return this.#nonPeekingTokenIndex
    }
    return this.#index
  }

  /**
   * @param {string | symbol} token
   * @param {number} index
   */
  stash(token, index) {
    assert(this.#stashedToken === null)
    this.#stashedToken = token
    this.#stashedTokenIndex = index
  }

  peek(greedyStrings = true) {
    if (this.#stashedToken !== null) {
      return this.#stashedToken
    }
    if (this.#peekingToken === null) {
      this.#nonPeekingTokenIndex = this.#index
      this.#peekingToken = this.nextToken(greedyStrings)
    }
    return this.#peekingToken
  }

  nextToken(greedyStrings = true) {
    if (this.#stashedToken !== null) {
      const result = this.#stashedToken
      this.#stashedToken = null
      return result
    }
    if (this.#peekingToken) {
      const result = this.#peekingToken
      this.#peekingToken = null
      return result
    }
    const char = this.pattern[this.#index]
    if (char === '.' && this.pattern[this.#index + 1] === '.') {
      this.#index += 2
      return DOT_DOT
    }

    if (char === '\\') {
      this.#index++
      const nextChar = this.pattern[this.#index]
      if (!nextChar) {
        return BACK_SLASH
      }
      if (escapableSymbolsRegex.test(nextChar)) {
        this.#index++
        return nextChar
      }
      return BACK_SLASH
    }
    const symbol = stringToSymbol[/** @type {keyof typeof stringToSymbol} **/ (char)]
    if (symbol) {
      this.#index++
      return symbol
    }

    if (!greedyStrings) {
      this.#index++
      return char
    }

    let string = this.pattern[this.#index++] ?? ''
    while (this.#index < this.pattern.length) {
      const char = this.pattern[this.#index]
      if (stringToSymbol[/** @type {keyof typeof stringToSymbol} **/ (char)]) {
        break
      }
      if (char === '\\') {
        this.#index++
        string += this.pattern[this.#index++]
        continue
      }
      string += this.pattern[this.#index++]
    }
    return string
  }

  hasMoreTokens() {
    return this.index < this.pattern.length
  }
}
