import { LazyFile } from '../fs/LazyFile.js'

/**
 * @param {string} key
 * @param {boolean} negating
 * @param {MatchFn} match
 * @returns {Matcher}
 */
export function matcher(key, negating, match) {
  return {
    key,
    negating,
    match,
    next: null,
  }
}

/**
 * @param {string} string
 * @returns {MatchFn}
 */
export const makeStringMatchFn = (string) => {
  return (entry, _options, matcher) => {
    if (string === entry.name) {
      return matcher.next ? 'next' : 'terminal'
    } else {
      return 'none'
    }
  }
}

/**
 * @param {RegExp} pattern
 * @returns {MatchFn}
 */
export const makeRegexpMatchFn = (pattern) => {
  return (entry, _options, matcher) => {
    // the dot option is handled by micromatch
    if (pattern.test(entry.name)) {
      return matcher.next ? 'next' : 'terminal'
    } else {
      return 'none'
    }
  }
}

/** @type {MatchFn} */
export const wildcardMatchFn = (entry, options, matcher) => {
  // ignore the entry if it's a dotfile and we're not matching dotfiles
  const ignore = entry.name[0] === '.' && !options.dot
  // if we are negating we should always match dotfiles, so we add an exception here
  if (ignore && !matcher.negating) {
    return 'none'
  }
  return matcher.next ? 'next' : 'terminal'
}

/** @type {MatchFn} */
export const oneCharMatchFn = (entry, _options, matcher) => {
  if (entry.name.length === 1) {
    return matcher.next ? 'next' : 'terminal'
  }
  return 'none'
}

/** @type {MatchFn} */
export const recursiveWildcardMatchFn = (entry, options, matcher) => {
  const ignore = entry.name[0] === '.' && !options.dot
  if (!matcher.next) {
    // negative wildcards always match dotfiles
    if (matcher.negating) return 'terminal'
    return ignore
      ? 'none'
      : options.expandDirectories || entry instanceof LazyFile
      ? 'terminal'
      : 'recur'
  } else {
    // If this entry is a dotfile and we're not matching dotfiles, then
    // a child matcher might still match the dotfile, so we don't want to ignore
    // it entirely.
    // e.g. we are matching "**/.lazy" with dot: false and comparing the "**" segment
    // against a dir called ".lazy". Normally the "**" would fail because it's a dotfile,
    // and we would ignore the ".lazy" dir entirely. But in this case, the ".lazy" dir should
    // match because it is explicitly named in the pattern.

    // The 'try-next' match result asks the caller to try this matcher's
    // children, but not to recursively apply this matcher to the entry's children.

    // 'recursive' means to recursively apply this matcher to the entry's children while
    // also trying the children of this matcher against the entry.
    return ignore ? 'try-next' : 'recur'
  }
}
