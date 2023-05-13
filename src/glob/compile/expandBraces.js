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
    case 'number_range':
      if (node.type === 'string' && node.value === '') {
        return [[]]
      }
      return [[node]]
    case 'braces':
    case 'parens': {
      if (node.type === 'parens' && node.extGlobPrefix) {
        return [[node]]
      }
      const result = node.options.flatMap(_expandBraces)
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
      const restPaths = _expandBraces({ type: 'sequence', expressions: rest, start: 0, end: 0 })
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
  return result
    .map((path) => {
      for (let i = path.length - 1; i > 0; i--) {
        const node = path[i]
        const prevNode = path[i - 1]
        if (node.type === 'separator' && prevNode.type === 'separator') {
          path.splice(i, 1)
        }
      }
      return path
    })
    .filter((p) => !!p.length)
}
