import pc from 'picocolors'

/**
 * @type {Array<{fg: import('picocolors/types.js').Formatter, bg: import('picocolors/types.js').Formatter}>}
 */
const colors = [
  { fg: pc.cyan, bg: pc.bgCyan },
  { fg: pc.magenta, bg: pc.bgMagenta },
  { fg: pc.yellow, bg: pc.bgYellow },
  { fg: pc.blue, bg: pc.bgBlue },
  { fg: pc.green, bg: pc.bgGreen },
]
/**
 * @param {string} str
 */
export function getColorForString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash % colors.length)]
}

/**
 * @param {string} prefix
 * @param {string} str
 */
export function prefixLines(prefix, str) {
  return str.replace(/^/gm, prefix)
}

/**
 * @param {string} str
 */
export function lastNonEmptyLineIfPossible(str) {
  const lines = str.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) {
      return lines[i]
    }
  }
  return ''
}

/**
 * @param {string} headline
 * @param {{ error?: Error, detail?: string }} [more]
 */
export function formatFailMessage(headline, more) {
  let result = pc.red(pc.bold('∙ ERROR ∙')) + ' ' + pc.red(headline)
  if (more?.detail) {
    result += '\n' + more.detail
  }
  if (more?.error?.stack) {
    result += '\n' + more.error.stack
  }
  return result
}

/**
 * @param {string[]} args
 */
export function formatInfoMessage(...args) {
  return `${args.join(' ')}`
}

/**
 * @param {string[]} args
 */
export function formatNoteMessage(...args) {
  return pc.gray(args.join(' '))
}

/**
 * @param {string[]} args
 */
export function formatWarningMessage(...args) {
  return `⚠️ ${pc.yellow(args.join(' '))}`
}

/**
 * @param {string[]} args
 */
export function formatSuccessMessage(...args) {
  return `${pc.green('✔')} ${args.join(' ')}`
}

/**
 * @param {string} str
 * @returns
 */
export function decapitalize(str) {
  return str && str[0].toLowerCase() + str.slice(1)
}

/**
 * @param {number} ms
 * @returns
 */
export const duration = (ms) => {
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 *
 * @param  {Array<(s: string) => string>} fns
 * @returns {(s: string) => string}
 */
export const pipe =
  (...fns) =>
  (x) =>
    fns.reduce((v, f) => f(v), x)
