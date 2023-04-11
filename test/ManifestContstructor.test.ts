import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import os from 'os'
import { dirname, join } from 'path'
import { ManifestConstructor } from '../src/manifest/ManifestConstructor.js'
import { rimraf } from '../src/rimraf.js'

const tmpdir = join(os.tmpdir(), 'lazyrepo-test')
function setup() {
  rimraf(tmpdir)
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
      .join('\n') + '\n'
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

  manifest.end()
})

it('should complain if types are added in non alphabetical order', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash2')
  expect(() => {
    manifest.update('env var', 'VERCEL_DEPLOY_KEY', 'hash2')
  }).toThrow()

  manifest.end()
})

it('should not complain if types are added in alphabetical order', async () => {
  const { previousManifestPath, nextManifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ previousManifestPath, nextManifestPath, diffPath })

  manifest.update('env var', 'VERCEL_DEPLOY_KEY', 'hash2')
  manifest.update('file', 'packages/core/src/index.ts', 'hash2')

  manifest.end()
})
