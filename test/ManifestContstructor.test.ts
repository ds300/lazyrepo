import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import os from 'os'
import { dirname, join } from 'path'
import { ManifestConstructor } from '../src/manifest/ManifestConstructor.js'
import { rimraf } from '../src/rimraf.js'

const tmpdir = join(os.tmpdir(), 'lazyrepo-test')
function setup() {
  rimraf(tmpdir)
  const manifestPath = join(tmpdir, 'manifests', 'test')
  const diffPath = join(tmpdir, 'diffs', 'test')

  if (!existsSync(dirname(manifestPath))) {
    mkdirSync(dirname(manifestPath), { recursive: true })
  }

  if (!existsSync(dirname(diffPath))) {
    mkdirSync(dirname(diffPath), { recursive: true })
  }
  return { manifestPath, diffPath }
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
  const { manifestPath, diffPath } = setup()
  const manifest = new ManifestConstructor({
    manifestPath,
    diffPath,
  })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(`file\tpackages/core/src/index.ts\thash1\n`)
  expect(existsSync(diffPath)).toBe(false)
})

test('it creates an empty manifest if one did not exist and nothing was added', async () => {
  const { manifestPath, diffPath } = setup()
  const manifest = new ManifestConstructor({
    manifestPath,
    diffPath,
  })

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(``)
  expect(existsSync(diffPath)).toBe(false)
})

test('it leaves an empty manifest empty if one did exist and nothing was added', async () => {
  const { manifestPath, diffPath } = setup()

  writeFileSync(manifestPath, '')

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(false)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(``)
  expect(existsSync(diffPath)).toBe(false)
})

test('it leaves a manifest empty if it was not previously empty and nothing was added', async () => {
  const { manifestPath, diffPath } = setup()

  writeFileSync(manifestPath, makeManifestString([['file', 'packages/core/src/index.ts', 'hash1']]))

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(``)
  expect(readFileSync(diffPath, 'utf8')).toMatchInlineSnapshot(`
    "- removed file packages/core/src/index.ts
    "
  `)
})

test('it adds things to an empty manifest', async () => {
  const { manifestPath, diffPath } = setup()

  writeFileSync(manifestPath, '')

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(`file\tpackages/core/src/index.ts\thash1\n`)
  expect(readFileSync(diffPath, 'utf8')).toMatchInlineSnapshot(`
    "+ added file packages/core/src/index.ts
    "
  `)
})

test('it creates a manifest but not a diff if there was no manifest before', async () => {
  const { manifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(`file\tpackages/core/src/index.ts\thash1\n`)
  expect(existsSync(diffPath)).toBe(false)
})

test('if nothing changed it does not create a new manifest', async () => {
  const { manifestPath, diffPath } = setup()

  writeFileSync(manifestPath, makeManifestString([['file', 'packages/core/src/index.ts', 'hash1']]))

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash1')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(false)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(`file\tpackages/core/src/index.ts\thash1\n`)
  expect(existsSync(diffPath)).toBe(false)
})

test('it should allow things to change', async () => {
  const { manifestPath, diffPath } = setup()

  writeFileSync(manifestPath, makeManifestString([['file', 'packages/core/src/index.ts', 'hash1']]))

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash2')

  const { hash, didChange } = await manifest.end()

  expect(hash).toHaveLength(64)
  expect(didChange).toBe(true)
  expect(readFileSync(manifestPath, 'utf8')).toEqual(`file\tpackages/core/src/index.ts\thash2\n`)
  expect(readFileSync(diffPath, 'utf8').toString()).toMatchInlineSnapshot(`
    "± changed file packages/core/src/index.ts
    "
  `)
})

describe('with multiple files', () => {
  let manifestPath: string, diffPath: string, manifest: ManifestConstructor
  beforeEach(() => {
    ;({ manifestPath, diffPath } = setup())
    writeFileSync(
      manifestPath,
      makeManifestString([
        ['file', 'packages/core/src/index.ts', 'hash1'],
        ['file', 'packages/core/src/index2.ts', 'hash2'],
        ['file', 'packages/core/src/index3.ts', 'hash3'],
      ]),
    )
    manifest = new ManifestConstructor({ manifestPath, diffPath })
  })

  test('it should allow things to be removed from the start', async () => {
    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')
    manifest.update('file', 'packages/core/src/index3.ts', 'hash3')

    const { hash, didChange } = await manifest.end()

    expect(hash).toHaveLength(64)
    expect(didChange).toBe(true)
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
    expect(readFileSync(manifestPath, 'utf8')).toEqual(
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
})

it('should complain if keys are added in non alphabetical order', async () => {
  const { manifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash2')
  expect(() => {
    manifest.update('file', 'packages/abacus/src/index.ts', 'hash2')
  }).toThrow()

  manifest.end()
})

it('should complain if types are added in non alphabetical order', async () => {
  const { manifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  manifest.update('file', 'packages/core/src/index.ts', 'hash2')
  expect(() => {
    manifest.update('env var', 'VERCEL_DEPLOY_KEY', 'hash2')
  }).toThrow()

  manifest.end()
})

it('should not complain if types are added in alphabetical order', async () => {
  const { manifestPath, diffPath } = setup()

  const manifest = new ManifestConstructor({ manifestPath, diffPath })

  manifest.update('env var', 'VERCEL_DEPLOY_KEY', 'hash2')
  manifest.update('file', 'packages/core/src/index.ts', 'hash2')

  manifest.end()
})
