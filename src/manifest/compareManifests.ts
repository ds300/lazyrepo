import k from 'kleur'


export type Change = {
	type: 'addition' | 'removal' | 'modification'
	value: string
}

export function compareManifests({
	currentManifest,
	previousManifest,
}: {
	currentManifest: string
	previousManifest: string
}) {
	const changes: Change[] = []
	const previousLines = previousManifest.trim().split('\n')
	const currentLines = currentManifest.trim().split('\n')

	let i = 0
	let j = 0

	while (i < previousLines.length || j < currentLines.length) {
		const [previousThing, previousHash] = (previousLines[i] || '').split('\t')
		const [currentThing, currentHash] = (currentLines[j] || '').split('\t')
		if (previousThing === currentThing) {
			i++
			j++
			if (previousHash !== currentHash) {
				changes.push({ type: 'modification', value: currentThing })
			}
		} else if (
			previousThing &&
			(previousThing < currentThing || (previousThing && !currentThing))
		) {
			i++
			changes.push({ type: 'removal', value: previousThing })
		} else {
			j++
			changes.push({ type: 'addition', value: currentThing })
		}
	}

	return changes
}

export function renderChange({ type, value }: Change): string {
	switch (type) {
		case 'addition':
			return k.bold().green('+') + ' added ' + value
		case 'modification':
			return k.bold().yellow('±') + ' modified ' + value
		case 'removal':
			return k.bold().red('-') + ' removed ' + value
	}
}
