/**
 * @param {Expression[]} expressions
 * @returns {Expression[]}
 */
function dedupeExpressions(expressions) {
  const seen = new Set()
  return expressions.filter((expr) => {
    const source = expr.type === 'string' ? expr.value : expr.source.slice(expr.start, expr.end)
    if (seen.has(source)) {
      return false
    }
    seen.add(source)
    return true
  })
}

/**
 * @param {Expression} node
 * @returns {Expression[][]}
 */
function _expandBraces(node) {
  switch (node.type) {
    case 'separator':
    case 'string':
    case 'character_class':
    case 'range_expansion':
    case 'wildcard':
    case 'recursive_wildcard':
      if (node.type === 'string' && node.value === '') {
        return [[]]
      }
      return [[node]]
    case 'braces':
    case 'parens': {
      if (node.type === 'parens' && node.extGlobPrefix) {
        return [[node]]
      }
      const result = dedupeExpressions(node.options).flatMap(_expandBraces)
      if (result.length === 0) {
        return [[]]
      }
      return result
    }
    case 'sequence': {
      if (node.expressions.length === 0) {
        return [[]]
      }
      if (node.expressions.length === 1) {
        return _expandBraces(node.expressions[0])
      }
      const [first, ...rest] = node.expressions
      const firstPaths = _expandBraces(first)
      const restPaths = _expandBraces({
        type: 'sequence',
        source: '',
        expressions: rest,
        start: 0,
        end: 0,
      })
      return restPaths.flatMap((restPath) => {
        return firstPaths.map((firstPath) => [...firstPath, ...restPath])
      })
    }
    default:
      // @ts-expect-error exhaustive check
      throw new Error(`Unexpected node type: ${node.type}`)
  }
}

/**
 * @param {Expression} node
 * @returns {Expression[][]}
 */
export function expandBraces(node) {
  const result = _expandBraces(node)
  for (let i = result.length - 1; i >= 0; i--) {
    const path = result[i]
    if (path.length === 0) {
      result.splice(i, 1)
      continue
    }

    // remove trailing slashes and double slashes
    while (path.length > 1 && path.at(-1)?.type === 'separator') {
      path.pop()
    }

    for (let j = path.length - 1; j > 0; j--) {
      const node = path[j]
      const prevNode = path[j - 1]
      if (node.type === 'separator' && prevNode.type === 'separator') {
        path.splice(j, 1)
      }
    }
  }
  return result
}

/**
 * This strips out the separators and returns the segments of the path as nested arrays
 * @param {Expression[]} path
 * @param {Expression[][]} cwd
 * @returns {{segments: Expression[][], hasIrreconcilableDotDot: boolean}}
 */
export function segmentize(path, cwd) {
  if (path.length === 0) {
    return { segments: [], hasIrreconcilableDotDot: false }
  }
  const isAbsolute = path[0]?.type === 'separator'
  /** @type {Expression[][]} */
  const segments = isAbsolute ? [] : [...cwd]
  /** @type {Expression[]} */
  let nextSegment = []
  for (let i = 0; i < path.length; i++) {
    const expr = path[i]
    if (expr.type === 'separator') {
      if (nextSegment.length > 0) {
        segments.push(nextSegment)
        nextSegment = []
      }
    } else {
      nextSegment.push(expr)
    }
  }
  // we would always expect the nextSegment to be nonempty unless the path is empty or ends in a forward slash
  // (which should never happen because we check for that above)
  if (nextSegment.length !== 0) {
    segments.push(nextSegment)
  }

  let hasDotDot = false

  // normalize path, removing `.` and `..` segments
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment.length === 1 && segment[0].type === 'string') {
      const value = segment[0].value
      if (value === '.') {
        segments.splice(i, 1)
      } else if (value === '..') {
        hasDotDot = true
      }
    }
  }

  let hasIrreconcilableDotDot = false
  if (hasDotDot) {
    let i = 1
    while (i < segments.length) {
      const prevSegment = segments[i - 1]
      const nextSegment = segments[i]
      if (
        nextSegment.length === 1 &&
        nextSegment[0].type === 'string' &&
        nextSegment[0].value === '..'
      ) {
        if (
          prevSegment.length === 1 &&
          prevSegment[0].type === 'string' &&
          prevSegment[0].value !== '..'
        ) {
          // simple path segment can be cancelled out
          segments.splice(i - 1, 2)
        } else {
          hasIrreconcilableDotDot = true
          i++
        }
      } else {
        i++
      }
    }
  }

  return { segments, hasIrreconcilableDotDot }
}
