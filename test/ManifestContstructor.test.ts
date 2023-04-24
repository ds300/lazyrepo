import { vol } from 'memfs'
import os from 'os'
import { dirname, join } from 'path'
import { rimraf } from 'rimraf'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from '../src/fs.js'
import { ManifestConstructor } from '../src/manifest/ManifestConstructor.js'
import { compareManifestTypes, types } from '../src/manifest/computeManifest.js'
import { LazyWriter } from '../src/manifest/manifest-types.js'

jest.mock('../src/fs.js', () => {
  return require('memfs')
})

jest.mock('../src/manifest/createLazyWriteStream.js', () => {
  function createLazyWriteStream(path: string): LazyWriter {
    let buffer = ''
    return {
      write(data: string) {
        buffer += data
      },
      close() {
        writeFileSync(path, buffer)
        return Promise.resolve()
      },
    }
  }
  return {
    createLazyWriteStream,
  }
})

beforeEach(() => {
  vol.reset()
})

const tmpdir = join(os.tmpdir(), 'lazyrepo-test')
function setup() {
  rimraf.sync(tmpdir)
  const previousManifestPath = join(tmpdir, 'manifests', 'test')
  const nextManifestPath = join(tmpdir, 'manifests', 'test.next')
  const diffPath = join(tmpdir, 'diffs', 'test')

  if (!existsSync(dirname(previousManifestPath))) {
    mkdirSync(dirname(previousManifestPath), { recursive: true })
  }

  if (!existsSync(dirname(diffPath))) {
    mkdirSync(dirname(diffPath), { recursive: true })
  }
  return { previousManifestPath, diffPath, nextManifestPath }
}

const makeManifestString = (entries: [string, string, string, string?][]) => {
  return (
    entries
      .map(
        ([type, path, hash, diffHash]) =>
          `${type}\t${path}\t${hash}${diffHash ? `\t${diffHash}` : ''}`,
      )
      .join('\n') + (entries.length ? '\n' : '')
  )
}

test('it creates a new manifest when one did not previously exist', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()
  const manifest = new ManifestConstructor({
    previousManifestPath,
    nextManifestPath,
    diffPath,
  })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
    `file\tpackages/core/src/index.ts\thash1\n`,
  )
  expect(existsSync(diffPath)).toBe(false)
})

test('it creates an empty manifest if one did not exist and nothing was added', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()
  const manifest = new ManifestConstructor({
    previousManifestPath,
    nextManifestPath,
    diffPath,
  })

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(nextManifestPath, 'utf8')).toEqual(``)
  expect(existsSync(diffPath)).toBe(false)
})

test('it leaves an empty manifest empty if one did exist and nothing was added', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  writeFileSync(previousManifestPath, '')

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(false)
  expect(readFileSync(previousManifestPath, 'utf8')).toEqual(``)
  expect(existsSync(nextManifestPath)).toBe(false)
  expect(existsSync(diffPath)).toBe(false)
})

test('it leaves a manifest empty if it was not previously empty and nothing was added', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  writeFileSync(
    previousManifestPath,
    makeManifestString([['file', 'packages/core/src/index.ts', 'hash1']]),
  )

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(nextManifestPath, 'utf8')).toEqual(``)
  expect(readFileSync(diffPath, 'utf8')).toMatchInlineSnapshot(`
    "- removed file packages/core/src/index.ts
    "
  `)
})

test('it adds things to an empty manifest', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  writeFileSync(previousManifestPath, '')

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
    `file\tpackages/core/src/index.ts\thash1\n`,
  )
  expect(readFileSync(diffPath, 'utf8')).toMatchInlineSnapshot(`
    "+ added file packages/core/src/index.ts
    "
  `)
})

test('it creates a manifest but not a diff if there was no manifest before', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
    `file\tpackages/core/src/index.ts\thash1\n`,
  )
  expect(existsSync(diffPath)).toBe(false)
})

test('if nothing changed it does not create a new manifest', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  writeFileSync(
    previousManifestPath,
    makeManifestString([['file', 'packages/core/src/index.ts', 'hash1']]),
  )

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(false)
  expect(existsSync(nextManifestPath)).toBe(false)
  expect(readFileSync(previousManifestPath, 'utf8')).toEqual(
    `file\tpackages/core/src/index.ts\thash1\n`,
  )
  expect(existsSync(diffPath)).toBe(false)
})

test('it should allow things to change', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  writeFileSync(
    previousManifestPath,
    makeManifestString([['file', 'packages/core/src/index.ts', 'hash1']]),
  )

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash2')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
    `file\tpackages/core/src/index.ts\thash2\n`,
  )
  expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
    "± changed file packages/core/src/index.ts
    "
  `)
})

describe('with multiple files', () => {
  let previousManifestPath: string,
    nextManifestPath: string,
    diffPath: string,
    manifest: ManifestConstructor
  beforeEach(() => {
    const setupResult = setup()
    nextManifestPath = setupResult.nextManifestPath
    previousManifestPath = setupResult.previousManifestPath
    diffPath = setupResult.diffPath
    writeFileSync(
      previousManifestPath,
      makeManifestString([
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )
    manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })
  })

  test('it should allow no changes', async () => {
    manifest.update('file', 'packages/core/src/index.ts', 'hash1')
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(false)

    expect(existsSync(nextManifestPath)).toBe(false)
    expect(readFileSync(previousManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )
    expect(existsSync(diffPath)).toBe(false)
  })

  test('it should allow things to be removed from the start', async () => {
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "- removed file packages/core/src/index.ts
      "
    `)
  })

  test('it should allow things to be removed from the middle', async () => {
    manifest.update('file', 'packages/core/src/index.ts', 'hash1')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "- removed file packages/core/src/index2.ts
      "
    `)
  })

  test('it should allow things to be removed from the end', async () => {
    manifest.update('file', 'packages/core/src/index.ts', 'hash1')
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
      ]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "- removed file packages/core/src/index3.ts
      "
    `)
  })

  test('it should allow multiple things to be removed from the end', async () => {
    manifest.update('file', 'packages/core/src/index.ts', 'hash1')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([['file', 'packages/core/src/index.ts', 'hash1']]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "- removed file packages/core/src/index2.ts
      - removed file packages/core/src/index3.ts
      "
    `)
  })

  test('it should allow multiple things to be removed from the start', async () => {
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([['file', 'packages/core/src/index3.ts', 'hash3']]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "- removed file packages/core/src/index.ts
      - removed file packages/core/src/index2.ts
      "
    `)
  })

  test('it should allow a thing to be added to the start', async () => {
    manifest.update('file', 'packages/abacus/src/index.ts', 'hashA')
    manifest.update('file', 'packages/core/src/index.ts', 'hash1')
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/abacus/src/index.ts', 'hashA'],
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "+ added file packages/abacus/src/index.ts
      "
    `)
  })

  test('it should allow multiple things to be added to the start', async () => {
    manifest.update('file', 'packages/abacus/src/index.ts', 'hashA')
    manifest.update('file', 'packages/abacus/src/index2.ts', 'hashB')
    manifest.update('file', 'packages/core/src/index.ts', 'hash1')
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/abacus/src/index.ts', 'hashA'],
        ['file', 'packages/abacus/src/index2.ts', 'hashB'],
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "+ added file packages/abacus/src/index.ts
      + added file packages/abacus/src/index2.ts
      "
    `)
  })

  test('it should allow things to be added, removed, and updated', async () => {
    manifest.update('file', 'packages/abacus/src/index.ts', 'hashA')
    manifest.update('file', 'packages/core/src/index.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/abacus/src/index.ts', 'hashA'],
        ['file', 'packages/core/src/index.ts', 'hash2'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
      ]),
    )
    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "+ added file packages/abacus/src/index.ts
      ± changed file packages/core/src/index.ts
      - removed file packages/core/src/index3.ts
      "
    `)
  })

  test('it should allow things to be updated at the start', async () => {
    manifest.update('file', 'packages/core/src/index.ts', 'hashA')
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['file', 'packages/core/src/index.ts', 'hashA'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )

    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "± changed file packages/core/src/index.ts
      "
    `)
  })

  test('it should allow an env var to be added at the start', async () => {
    manifest.update('env var', 'VERCEL_DEPLOY_KEY', 'hashA')
    manifest.update('file', 'packages/core/src/index.ts', 'hash1')
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(
      makeManifestString([
        ['env var', 'VERCEL_DEPLOY_KEY', 'hashA'],
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )

    expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
      "+ added env var VERCEL_DEPLOY_KEY
      "
    `)
  })
})

it('should complain if keys are added in non alphabetical order', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash2')
  expect(() => {
    manifest.update('file', 'packages/abacus/src/index.ts', 'hash2')
  }).toThrow()

  await manifest.end()
})

it('should complain if types are added in non alphabetical order', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash2')
  expect(() => {
    manifest.update('env var', 'VERCEL_DEPLOY_KEY', 'hash2')
  }).toThrow()

  await manifest.end()
})

it('should not complain if types are added in alphabetical order', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  expect(() => {
    manifest.update('env var', 'VERCEL_DEPLOY_KEY', 'hash2')
    manifest.update('file', 'packages/core/src/index.ts', 'hash2')
  }).not.toThrow()

  await manifest.end()
})

type ManifestLineType = (typeof types)[keyof typeof types]
type Line = [ManifestLineType, string, string, string | undefined]

class Random {
  constructor(private _seed: number) {}

  random(n: number = Number.MAX_SAFE_INTEGER) {
    this._seed = (this._seed * 9301 + 49297) % 233280
    // float is a number between 0 and 1
    const float = this._seed / 233280
    return Math.floor(float * n)
  }

  choice<Result>(choices: Array<(() => any) | { weight: number; do: () => any }>): Result {
    type Choice = (typeof choices)[number]
    const getWeightFromChoice = (choice: Choice) => ('weight' in choice ? choice.weight : 1)
    const totalWeight = Object.values(choices).reduce(
      (total, choice) => total + getWeightFromChoice(choice),
      0,
    )
    const randomWeight = this.random(totalWeight)
    let weight = 0
    for (const choice of Object.values(choices)) {
      weight += getWeightFromChoice(choice)
      if (randomWeight < weight) {
        return 'do' in choice ? choice.do() : choice()
      }
    }
    throw new Error('unreachable')
  }

  randomType(): ManifestLineType {
    return this.choice(Object.values(types).map((type) => () => type))
  }

  randomId() {
    return 'id__' + this.random().toString(36)
  }

  randomHash() {
    return 'hash__' + this.randomId()
  }

  randomMeta() {
    return 'meta__' + this.randomId()
  }

  randomLine(): Line {
    if (this.random(2) === 0) {
      return [this.randomType(), this.randomId(), this.randomHash(), undefined]
    } else {
      return [this.randomType(), this.randomId(), this.randomHash(), this.randomMeta()]
    }
  }

  randomLines(n: number): Array<Line> {
    return Array.from({ length: n }, () => this.randomLine()).sort(lineComparator)
  }

  editLines({
    lines,
    numEdits,
    numDeletions,
    numAdditions,
    numMetaUpdates,
  }: {
    lines: Line[]
    numEdits: number
    numDeletions: number
    numAdditions: number
    numMetaUpdates: number
  }): Line[] {
    const result = [...lines]
    for (let i = 0; i < numEdits; i++) {
      if (lines.length === 0) continue
      const index = this.random(result.length)
      const [type, id, _hash, _meta] = result[index]
      result[index] = [type, id, this.randomHash(), this.randomMeta()]
    }
    for (let i = 0; i < numMetaUpdates; i++) {
      if (lines.length === 0) continue
      const index = this.random(result.length)
      const [type, id, hash, _meta] = result[index]
      result[index] = [type, id, hash, this.randomMeta()]
    }
    for (let i = 0; i < numDeletions; i++) {
      if (lines.length === 0) continue
      const index = this.random(result.length)
      result.splice(index, 1)
    }
    for (let i = 0; i < numAdditions; i++) {
      result.push(this.randomLine())
    }
    return result.sort(lineComparator)
  }
}

const lineComparator = (a: Line, b: Line) => {
  const typeComparison = compareManifestTypes(a[0], b[0])
  if (typeComparison !== 0) {
    return typeComparison
  }

  const idComparison = a[1].localeCompare(b[1])

  if (idComparison !== 0) {
    return idComparison
  }

  const hashComparison = a[2].localeCompare(b[2])

  if (hashComparison !== 0) {
    return hashComparison
  }

  return 0
}

async function runCreationTest(seed: number) {
  const random = new Random(seed)
  const numLines = random.random(20)
  const lines = random.randomLines(numLines)

  const previousManifestPath = '/manifest'
  const nextManifestPath = '/manifest.next'
  const diffPath = '/manifest.diff'

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })
  for (const line of lines) {
    manifest.update(...line)
  }

  const { hash, didChange, didWriteDiff, didWriteManifest } = await manifest.end()

  expect(didWriteDiff).toBe(false)
  expect(didWriteManifest).toBe(true)
  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(nextManifestPath, 'utf8')).toEqual(makeManifestString(lines))
}

for (let i = 0; i < 1000; i++) {
  const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  // eslint-disable-next-line jest/expect-expect
  test(`random test ${seed}`, async () => {
    await runCreationTest(i)
  })
}

function getDiff(linesA: Line[], linesB: Line[]) {
  const aById = Object.fromEntries(linesA.map((line) => [line[1], line]))

  const bById = Object.fromEntries(linesB.map((line) => [line[1], line]))

  const deletedIds = new Set(Object.keys(aById).filter((id) => !(id in bById)))
  const addedIds = new Set(Object.keys(bById).filter((id) => !(id in aById)))
  const updatedIds = new Set(
    Object.keys(aById).filter((id) => id in bById && aById[id][2] !== bById[id][2]),
  )

  const allIds = [...deletedIds, ...addedIds, ...updatedIds].sort((a, b) => {
    const aType = aById[a] ? aById[a][0] : bById[a][0]
    const bType = aById[b] ? aById[b][0] : bById[b][0]
    const typeComparison = compareManifestTypes(aType, bType)
    if (typeComparison !== 0) {
      return typeComparison
    }
    return a.localeCompare(b)
  })

  let diff = ''
  for (const id of allIds) {
    const type = aById[id] ? aById[id][0] : bById[id][0]
    if (deletedIds.has(id)) {
      diff += `- removed ${type} ${id}\n`
    } else if (addedIds.has(id)) {
      diff += `+ added ${type} ${id}\n`
    } else {
      diff += `± changed ${type} ${id}\n`
    }
  }
  return diff
}

async function runUpdateTest(seed: number) {
  const random = new Random(seed)
  const numLines = random.random(20)
  const lines = random.randomLines(numLines)

  const previousManifestPath = '/manifest'
  const nextManifestPath = '/manifest.next'
  const diffPath = '/manifest.diff'

  writeFileSync(previousManifestPath, makeManifestString(lines))

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  const numAdditions = random.random(5)
  const numDeletions = random.random(5)
  const numEdits = random.random(5)
  const numMetaUpdates = random.random(5)

  const newLines = random.editLines({
    lines,
    numAdditions,
    numDeletions,
    numEdits,
    numMetaUpdates,
  })

  const manifestsAreDifferent = makeManifestString(lines) !== makeManifestString(newLines)
  const manifestHashesAreDifferent =
    lines.map((line) => line[2]).join('') !== newLines.map((line) => line[2]).join('')

  for (const line of newLines) {
    const [type, id, _hash, meta] = line
    if (meta && manifest.copyLineOverIfMetaIsSame(type, id, meta)) {
      continue
    }
    manifest.update(...line)
  }

  const { hash, didChange, didWriteDiff, didWriteManifest } = await manifest.end()

  expect(didWriteDiff).toBe(manifestHashesAreDifferent)
  expect(didWriteManifest).toBe(manifestsAreDifferent)
  expect(hash).toHaveLength(64)
  expect(didChange).toBe(manifestHashesAreDifferent)
  if (didWriteManifest) {
    expect(readFileSync(nextManifestPath, 'utf8')).toEqual(makeManifestString(newLines))
  }
  if (didWriteDiff) {
    expect(readFileSync(diffPath, 'utf8')).toEqual(getDiff(lines, newLines))
  }
}

for (let i = 0; i < 1000; i++) {
  const seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
  // eslint-disable-next-line jest/expect-expect
  test(`random test ${seed}`, async () => {
    await runUpdateTest(seed)
  })
}
