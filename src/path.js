/* eslint-disable @typescript-eslint/unbound-method */
/**
 * We want to always use posix-style forward slash paths
 */

// eslint-disable-next-line no-restricted-imports
import path from 'path'
import slash from 'slash'
export const isAbsolute = path.isAbsolute

/** @type {typeof path.resolve} */
export const resolve = (...args) => slash(path.resolve(...args))
/** @type {typeof path.relative} */
export const relative = (...args) => slash(path.relative(...args))
/** @type {typeof path.join} */
export const join = (...args) => slash(path.join(...args))
/** @type {typeof path.dirname} */
export const dirname = (...args) => slash(path.dirname(...args))
/** @type {typeof path.basename} */
export const basename = (...args) => slash(path.basename(...args))
/** @type {typeof path.normalize} */
export const normalize = (...args) => slash(path.normalize(...args))
