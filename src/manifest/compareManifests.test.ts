import { Change, compareManifests } from './compareManifests'

function changes(...changes: Change[]): Change[] {
	return changes
}
function manifest(...lines: [string, string][]): string {
	return lines.map(([entity, value]) => `${entity}\t${value}`).join('\n')
}

describe(compareManifests, () => {
	it(`returns zero changes when no things changed`, async () => {
		expect(compareManifests({ currentManifest: '', previousManifest: '' })).toEqual([])

		for (let i = 0; i < 1000; i++) {
			let manifest = ''
			const numLines = Math.ceil(Math.random() * 10)
			for (let j = 0; j < numLines; j++) {
				manifest += `${Math.random()}\t${Math.random()}\n`
			}
			try {
				expect(
					compareManifests({
						currentManifest: manifest,
						previousManifest: manifest,
					})
				).toEqual([])
			} catch (error) {
				console.log(`badly handled manifest`, JSON.stringify(manifest))
				throw error
			}
		}
		expect(compareManifests({ currentManifest: '', previousManifest: '' })).toEqual([])
	})

	it('correctly picks up things being removed', () => {
		expect(
			compareManifests({
				previousManifest: manifest(['a', '0']),
				currentManifest: '',
			})
		).toEqual(changes({ type: 'removal', value: 'a' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1']),
				currentManifest: manifest(['b', '1']),
			})
		).toEqual(changes({ type: 'removal', value: 'a' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1']),
				currentManifest: manifest(['a', '0']),
			})
		).toEqual(changes({ type: 'removal', value: 'b' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1'], ['c', '2']),
				currentManifest: manifest(['a', '0'], ['c', '2']),
			})
		).toEqual(changes({ type: 'removal', value: 'b' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1'], ['c', '2']),
				currentManifest: manifest(['a', '0']),
			})
		).toEqual(changes({ type: 'removal', value: 'b' }, { type: 'removal', value: 'c' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1'], ['c', '2']),
				currentManifest: manifest(),
			})
		).toEqual(
			changes(
				{ type: 'removal', value: 'a' },
				{ type: 'removal', value: 'b' },
				{ type: 'removal', value: 'c' }
			)
		)
	})

	it(`correctly picks up things being added`, async () => {
		expect(
			compareManifests({
				previousManifest: '',
				currentManifest: manifest(['a', '0']),
			})
		).toEqual(changes({ type: 'addition', value: 'a' }))

		expect(
			compareManifests({
				previousManifest: manifest(['b', '1']),
				currentManifest: manifest(['a', '0'], ['b', '1']),
			})
		).toEqual(changes({ type: 'addition', value: 'a' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0']),
				currentManifest: manifest(['a', '0'], ['b', '1']),
			})
		).toEqual(changes({ type: 'addition', value: 'b' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['c', '2']),
				currentManifest: manifest(['a', '0'], ['b', '1'], ['c', '2']),
			})
		).toEqual(changes({ type: 'addition', value: 'b' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0']),
				currentManifest: manifest(['a', '0'], ['b', '1'], ['c', '2']),
			})
		).toEqual(changes({ type: 'addition', value: 'b' }, { type: 'addition', value: 'c' }))

		expect(
			compareManifests({
				previousManifest: manifest(['b', '1']),
				currentManifest: manifest(['a', '0'], ['b', '1'], ['c', '2']),
			})
		).toEqual(changes({ type: 'addition', value: 'a' }, { type: 'addition', value: 'c' }))
	})

	it(`correctly picks up things being modified`, async () => {
		expect(
			compareManifests({
				previousManifest: manifest(['a', '0']),
				currentManifest: manifest(['a', '1']),
			})
		).toEqual(changes({ type: 'modification', value: 'a' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1']),
				currentManifest: manifest(['a', '1'], ['b', '1']),
			})
		).toEqual(changes({ type: 'modification', value: 'a' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1']),
				currentManifest: manifest(['a', '0'], ['b', '2']),
			})
		).toEqual(changes({ type: 'modification', value: 'b' }))

		expect(
			compareManifests({
				previousManifest: manifest(['a', '0'], ['b', '1']),
				currentManifest: manifest(['a', '1'], ['b', '2']),
			})
		).toEqual(changes({ type: 'modification', value: 'a' }, { type: 'modification', value: 'b' }))
	})
})
