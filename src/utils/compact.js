/**
 * @template T
 * @param {T[]} arr
 * @returns {NonNullable<T>[]}
 */
// @ts-expect-error
export const compact = (arr) => arr.filter(Boolean)
