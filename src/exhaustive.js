/**
 * @param {never} value
 * @returns {never}
 */
export function exhaustive(value) {
  throw new Error(`Unexpected value: ${String(value)}`)
}
