import kleur from 'kleur'

const { bold, gray } = kleur

function required(name: string) {
	return gray('<') + name + gray('>')
}

export function help(error?: boolean) {
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
