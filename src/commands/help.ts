import kleur from 'kleur'

const { bold, gray } = kleur

function required(name: string) {
	return gray('<') + name + gray('>')
}

export function help(error?: boolean) {
	// eslint-disable-next-line no-console
	console[error ? 'error' : 'log'](`USAGE

  ${bold('burbo')} ${required('task')} [...args]
`)
}
