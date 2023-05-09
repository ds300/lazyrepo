const OPEN_PAREN = Symbol('(')
const CLOSE_PAREN = Symbol(')')
const PIPE = Symbol('|')

/** @param {string} pattern */
function tokenize(pattern) {
  /** @type {Array<string | symbol>} */
  const result = []
  let string = ''

  /** @param {symbol} symbol */
  const commit = (symbol) => {
    if (string) {
      result.push(string)
      string = ''
    }
    result.push(symbol)
  }

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\') {
      if (pattern[i + 1]?.match(/[()|]/)) {
        string += '\\' + pattern[i + 1]
        i++
      } else {
        string += '\\'
      }
      continue
    }

    if (char === '(') {
      commit(OPEN_PAREN)
      continue
    }

    if (char === ')') {
      commit(CLOSE_PAREN)
      continue
    }

    if (char === '|') {
      commit(PIPE)
      continue
    }

    string += char
  }

  if (string) result.push(string)

  return result
}

/**
 * @typedef {Array<string | Ast>} Ast
 */

/** @param {string} pattern */
export function convertParens(pattern) {
  if (!pattern.includes('(')) {
    return pattern
  }
  const tokens = tokenize(pattern)
  let i = 0

  /**
   * @param {symbol[]} stoppingTokens
   */
  const parseString = (stoppingTokens) => {
    let result = ''
    while (i < tokens.length) {
      const token = tokens[i]
      if (typeof token === 'string') {
        result += token
        i++
        continue
      }
      if (stoppingTokens?.includes(token)) {
        return result
      }
      result += token.description
      i++
    }
    return result
  }

  /**
   * @param {symbol[]} stoppingTokens
   */
  const parseExpr = (stoppingTokens) => {
    const token = tokens[i]

    if (token === OPEN_PAREN) {
      i++
      return parseGroup(PIPE, CLOSE_PAREN)
    }
    return parseString(stoppingTokens)
  }

  /**
   * @param {symbol} separator
   * @param {symbol} terminator
   * @returns {ExpansionAST}
   */
  const parseGroup = (separator, terminator) => {
    /** @type {ExpansionAST[]} */
    const choices = []

    while (i < tokens.length) {
      choices.push(parseExpr([separator, terminator, OPEN_PAREN]))
      if (tokens[i] === terminator) {
        i++
        return { type: 'group', choices }
      }
      if (tokens[i] === separator) {
        i++
      }
    }

    throw new Error(`Unterminated group in pattern: '${pattern}'`)
  }

  /** @type {ExpansionAST[]} */
  const parts = []

  while (i < tokens.length) {
    parts.push(parseExpr([OPEN_PAREN]))
  }

  let output = ''

  /** @param {ExpansionAST[]} parts */
  const writeParts = (parts) => {
    for (const part of parts) {
      if (typeof part === 'string') {
        output += part
      } else {
        output += '{'
        for (let i = 0; i < part.choices.length; i++) {
          writeParts([part.choices[i]])
          if (i < part.choices.length - 1) {
            output += ','
          }
        }
        output += '}'
      }
    }
  }
  writeParts(parts)

  return output
}
