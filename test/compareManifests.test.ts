import { describe, expect, it } from 'vitest'
import { compareManifests } from '../src/manifest/compareManifests.js'
import { ManifestChange } from '../src/types.js'

function changes(...changes: ManifestChange[]): ManifestChange[] {
  return changes
}
function manifest(...lines: [string, string][]): string {
  return lines.map(([entity, value]) => `${entity}\t${value}`).join('\n')
}

describe('compareManifests', () => {
  it(`returns zero changes when no things changed`, async () => {
    expect(compareManifests('', '')).toEqual([])

    for (let i = 0; i < 1000; i++) {
      let manifest = ''
      const numLines = Math.ceil(Math.random() * 10)
      for (let j = 0; j < numLines; j++) {
        manifest += `${Math.random()}\t${Math.random()}\n`
      }
      try {
        expect(compareManifests(manifest, manifest)).toEqual([])
      } catch (error) {
        console.log(`badly handled manifest`, JSON.stringify(manifest))
        throw error
      }
    }
    expect(compareManifests('', '')).toEqual([])
  })

  it('correctly picks up things being removed', () => {
    expect(compareManifests(manifest(['a', '0']), '')).toEqual(
      changes({ type: 'removal', value: 'a' }),
    )

    expect(compareManifests(manifest(['a', '0'], ['b', '1']), manifest(['b', '1']))).toEqual(
      changes({ type: 'removal', value: 'a' }),
    )

    expect(compareManifests(manifest(['a', '0'], ['b', '1']), manifest(['a', '0']))).toEqual(
      changes({ type: 'removal', value: 'b' }),
    )

    expect(
      compareManifests(
        manifest(['a', '0'], ['b', '1'], ['c', '2']),
        manifest(['a', '0'], ['c', '2']),
      ),
    ).toEqual(changes({ type: 'removal', value: 'b' }))

    expect(
      compareManifests(manifest(['a', '0'], ['b', '1'], ['c', '2']), manifest(['a', '0'])),
    ).toEqual(changes({ type: 'removal', value: 'b' }, { type: 'removal', value: 'c' }))

    expect(compareManifests(manifest(['a', '0'], ['b', '1'], ['c', '2']), manifest())).toEqual(
      changes(
        { type: 'removal', value: 'a' },
        { type: 'removal', value: 'b' },
        { type: 'removal', value: 'c' },
      ),
    )
  })

  it(`correctly picks up things being added`, async () => {
    expect(compareManifests('', manifest(['a', '0']))).toEqual(
      changes({ type: 'addition', value: 'a' }),
    )

    expect(compareManifests(manifest(['b', '1']), manifest(['a', '0'], ['b', '1']))).toEqual(
      changes({ type: 'addition', value: 'a' }),
    )

    expect(compareManifests(manifest(['a', '0']), manifest(['a', '0'], ['b', '1']))).toEqual(
      changes({ type: 'addition', value: 'b' }),
    )

    expect(
      compareManifests(
        manifest(['a', '0'], ['c', '2']),
        manifest(['a', '0'], ['b', '1'], ['c', '2']),
      ),
    ).toEqual(changes({ type: 'addition', value: 'b' }))

    expect(
      compareManifests(manifest(['a', '0']), manifest(['a', '0'], ['b', '1'], ['c', '2'])),
    ).toEqual(changes({ type: 'addition', value: 'b' }, { type: 'addition', value: 'c' }))

    expect(
      compareManifests(manifest(['b', '1']), manifest(['a', '0'], ['b', '1'], ['c', '2'])),
    ).toEqual(changes({ type: 'addition', value: 'a' }, { type: 'addition', value: 'c' }))
  })

  it(`correctly picks up things being modified`, async () => {
    expect(compareManifests(manifest(['a', '0']), manifest(['a', '1']))).toEqual(
      changes({ type: 'modification', value: 'a' }),
    )

    expect(
      compareManifests(manifest(['a', '0'], ['b', '1']), manifest(['a', '1'], ['b', '1'])),
    ).toEqual(changes({ type: 'modification', value: 'a' }))

    expect(
      compareManifests(manifest(['a', '0'], ['b', '1']), manifest(['a', '0'], ['b', '2'])),
    ).toEqual(changes({ type: 'modification', value: 'b' }))

    expect(
      compareManifests(manifest(['a', '0'], ['b', '1']), manifest(['a', '1'], ['b', '2'])),
    ).toEqual(changes({ type: 'modification', value: 'a' }, { type: 'modification', value: 'b' }))
  })
})
