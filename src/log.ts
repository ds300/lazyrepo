import k from 'kleur'

const { cyan, grey, red, green, bold } = k

let stdout = process.stdout

export function silence() {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  stdout = { write() {} } as any
}

function writeLine(...args: any[]) {
  stdout.write(args.join(' ') + '\n')
}

function decapitalize(str: string) {
  return str && str[0].toLowerCase() + str.slice(1)
}

async function timedStep<T>(str: string, task: () => T | Promise<T>): Promise<T> {
  stdout.write(cyan(`• `) + str + '...')
  const start = Date.now()
  block()
  const done = () => {
    stdout.write(cyan(' ' + timeSince(start) + '\n'))
    release()
  }
  try {
    return await Promise.resolve(task()).then((result: any) => {
      done()
      return result
    })
  } catch (error: any) {
    return log.fail('Unexpected error', { error })
  }
}

async function timedSubstep<T>(str: string, task: () => T | Promise<T>): Promise<T> {
  stdout.write(grey('  ' + str + '...'))
  const start = Date.now()
  block()
  const done = () => {
    stdout.write(cyan(' ' + timeSince(start) + '\n'))
    release()
  }
  try {
    return await Promise.resolve(task()).then((result: any) => {
      done()
      return result
    })
  } catch (error: any) {
    return log.fail('Unexpected error', { error })
  }
}

const logQueue: Array<() => void> = []
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
function queueify<Args extends any[]>(f: (...args: Args) => void) {
  return (...args: Args) => {
    if (isBlocked) {
      logQueue.push(() => f(...args))
    } else {
      f(...args)
    }
  }
}

export const log = {
  fail(headline: string, more?: { error?: Error; detail?: string }) {
    console.error('\n\n' + red().bold('∙ ERROR ∙'), red(headline))
    more?.detail && console.error('\n' + more.detail)
    more?.error && console.error('\n', more.error)
    process.exit(1)
  },
  task: (str: string) => writeLine(green('\n::'), bold(str), green('::\n')),
  step: (str: string) => writeLine(cyan(`•`), str),
  substep: queueify((str: string) => writeLine(grey('  ' + str))),
  success: (str: string) => writeLine('\n' + green(`✔`), bold(str)),
  info: (str: string) => writeLine('💡', str),
  timedStep,
  timedSubstep,
  timedTask: (str: string) => {
    log.task(str)
    const start = Date.now()
    return (msg = `Finished ${decapitalize(str)}`) => {
      log.success(`${msg} in ${timeSince(start)}`)
    }
  },
  log: writeLine,
}

const timeSince = (start: number) => `${((Date.now() - start) / 1000).toFixed(2)}s`
