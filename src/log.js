import k from 'kleur'

const { cyan, grey, red, green, bold } = k

let stdout = process.stdout

export function silence() {
  // @ts-expect-error
  stdout = { write() {} }
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

/**
 *
 * @template T
 * @param {string} str
 * @param {() => T | Promise<T>} task
 * @returns {Promise<T>}
 */
async function timedStep(str, task) {
  stdout.write(cyan(`• `) + str + '...')
  const start = Date.now()
  block()
  const done = () => {
    stdout.write(cyan(' ' + timeSince(start) + '\n'))
    release()
  }
  try {
    return await Promise.resolve(task()).then((result) => {
      done()
      return result
    })
  } catch (/** @type {any} */ error) {
    return log.fail('Unexpected error', { error })
  }
}

/**
 *
 * @template T
 * @param {string} str
 * @param {() => T | Promise<T>} task
 * @returns {Promise<T>}
 */
async function timedSubstep(str, task) {
  stdout.write(grey('  ' + str + '...'))
  const start = Date.now()
  block()
  const done = () => {
    stdout.write(cyan(' ' + timeSince(start) + '\n'))
    release()
  }
  try {
    return await Promise.resolve(task()).then((result) => {
      done()
      return result
    })
  } catch (/** @type {any} */ error) {
    return log.fail('Unexpected error', { error })
  }
}

/**
 * @type {(() => void)[]}
 */
const logQueue = []
let isBlocked = false

function block() {
  isBlocked = true
}

function release() {
  isBlocked = false
  while (logQueue.length) {
    logQueue.shift()?.()
  }
}

/**
 * @template {any[]} Args
 * @param {(...args: Args) => void} f
 * @returns {(...args: Args) => void}
 */
function queueify(f) {
  return (...args) => {
    if (isBlocked) {
      logQueue.push(() => f(...args))
    } else {
      f(...args)
    }
  }
}

export const log = {
  /**
   * @param {string} headline
   * @param {{ error?: Error, detail?: string }} [more]
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
  substep: queueify((str) => writeLine(grey('  ' + str))),
  /**
   * @param {string} str
   */
  success: (str) => writeLine('\n' + green(`✔`), bold(str)),
  /**
   * @param {string} str
   */
  info: (str) => writeLine('💡', str),
  timedStep,
  timedSubstep,
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
const timeSince = (start) => `${((Date.now() - start) / 1000).toFixed(2)}s`
