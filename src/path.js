/* eslint-disable @typescript-eslint/unbound-method */
/**
 * We want to always use posix-style forward slash paths
 */

// eslint-disable-next-line no-restricted-imports
import { posix } from 'path'
export const resolve = posix.resolve
export const relative = posix.relative
export const join = posix.join
export const isAbsolute = posix.isAbsolute
export const dirname = posix.dirname
export const basename = posix.basename
