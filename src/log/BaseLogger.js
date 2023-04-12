import k from 'kleur'

/**
 * @type {Array<import('kleur').Color>}
 */
const colors = [k.cyan, k.magenta, k.yellow, k.blue, k.green]
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
 * @param {string} headline
 * @param {{ error?: Error, detail?: string }} [more]
 */
export function formatFailMessage(headline, more) {
  let result = k.red().bold('∙ ERROR ∙') + ' ' + k.red(headline)
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
  return `💡 ${args.join(' ')}`
}

/**
 * @param {string[]} args
 */
export function formatVerboseMessage(...args) {
  return k.gray(args.join(' '))
}

/**
 * @param {string[]} args
 */
export function formatSuccessMessage(...args) {
  return `${k.green('✔')} ${args.join(' ')}`
}

/**
 * @param {string} str
 * @returns
 */
export function decapitalize(str) {
  return str && str[0].toLowerCase() + str.slice(1)
}

/**
 * @param {number} start
 * @returns {string}
 */
export const timeSince = (start) => `${((Date.now() - start) / 1000).toFixed(2)}s`
