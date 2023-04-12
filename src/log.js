import k from 'kleur'

const { cyan, red, green, bold } = k

let stdout = process.stdout

export function silence() {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  stdout = { write: () => {} }
}

/**
 *
 * @param  {...any} args
 */
function writeLine(...args) {
  stdout.write(args.join(' ') + '\n')
}

/**
 * @param {string} str
 * @returns
 */
function decapitalize(str) {
  return str && str[0].toLowerCase() + str.slice(1)
}

export const log = {
  /**
   * @param {string} headline
   * @param {{ error?: Error, detail?: string }} [more]
   * @returns {never}
   */
  fail(headline, more) {
    console.error('\n\n' + red().bold('∙ ERROR ∙'), red(headline))
    more?.detail && console.error('\n' + more.detail)
    more?.error && console.error('\n', more.error)
    process.exit(1)
  },
  /**
   * @param {string} str
   */
  task: (str) => writeLine(green('\n::'), bold(str), green('::\n')),
  /**
   * @param {string} str
   */
  step: (str) => writeLine(cyan(`•`), str),
  /**
   * @param {string} str
   */
  success: (str) => writeLine('\n' + green(`✔`), bold(str)),
  /**
   * @param {string} str
   */
  info: (str) => writeLine('💡', str),
  /**
   * @param {string} str
   */
  timedTask: (str) => {
    log.task(str)
    const start = Date.now()
    return (msg = `Finished ${decapitalize(str)}`) => {
      log.success(`${msg} in ${timeSince(start)}`)
    }
  },
  log: writeLine,
}
/**
 * @param {number} start
 * @returns {string}
 */
export const timeSince = (start) => `${((Date.now() - start) / 1000).toFixed(2)}s`
