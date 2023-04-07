import kleur from 'kleur'

const { bold, gray } = kleur

/**
 * @param {string} name
 * @returns
 */
function required(name) {
  return gray('<') + name + gray('>')
}

/**
 * @param {boolean} [error]
 */
export function help(error) {
  // eslint-disable-next-line no-console
  console[error ? 'error' : 'log'](`USAGE

Running tasks:

  ${bold('lazy run')} ${required('task')} [...args]

Creating a blank config file

  ${bold('lazy init')} ${required('task')} [...args]

Showing this help message

  ${bold('lazy help')}
`)
}
