import { ManifestConstructor } from '../src/manifest/computeManifest.js'

const stringWriter = () => {
  const res = {
    value: '',
    isClosed: false,
    write(chunk: string): void {
      res.value += chunk
    },
    end() {
      res.isClosed = true
    },
  }
  return res
}

describe('ManifestConstructor', () => {
  it('should work with empty manifests', () => {
    const manifestWriter = stringWriter()
    const diffWriter = stringWriter()
    const manifest = new ManifestConstructor('', manifestWriter, diffWriter)

    const { hash, didChange } = manifest.end()

    expect(hash).toMatchInlineSnapshot(
      '"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"',
    )
    expect(didChange).toBe(false)
    expect(manifestWriter.value).toEqual(``)
    expect(diffWriter.value).toEqual(``)
  })

  it('should allow things to be added to an empty manifest', () => {
    const manifestWriter = stringWriter()
    const diffWriter = stringWriter()
    const manifest = new ManifestConstructor('', manifestWriter, diffWriter)

    manifest.update('file', 'packages/core/src/index.ts', 'hash1')

    const { hash, didChange } = manifest.end()

    expect(hash).toMatchInlineSnapshot(
      '"9ae689b9c0f8b610ff4a4b58238106b8b6085db1bd82b3016ecaf69ea0963f02"',
    )

    expect(didChange).toBe(true)
    expect(manifestWriter.value).toEqual(`file\tpackages/core/src/index.ts\thash1\n`)

    expect(diffWriter.value).toEqual(`+ added\tfile\tpackages/core/src/index.ts\n`)
  })

  const simpleTestManifest = [`file\tpackages/core/src/index.ts\thash1`].join('\n') + '\n'

  it('should allow things to be equal', () => {
    const manifestWriter = stringWriter()
    const diffWriter = stringWriter()
    const manifest = new ManifestConstructor(simpleTestManifest, manifestWriter, diffWriter)

    manifest.update('file', 'packages/core/src/index.ts', 'hash1')

    const { hash, didChange } = manifest.end()

    expect(diffWriter.value).toEqual('')
    expect(didChange).toBe(false)
    expect(manifestWriter.value).toEqual(simpleTestManifest)
    expect(hash).toMatchInlineSnapshot(
      '"9ae689b9c0f8b610ff4a4b58238106b8b6085db1bd82b3016ecaf69ea0963f02"',
    )
    expect(diffWriter.isClosed).toBe(true)
    expect(manifestWriter.isClosed).toBe(true)
  })

  it('should allow things to change', () => {
    const manifestWriter = stringWriter()
    const diffWriter = stringWriter()
    const manifest = new ManifestConstructor(simpleTestManifest, manifestWriter, diffWriter)

    manifest.update('file', 'packages/core/src/index.ts', 'hash2')

    const { hash, didChange } = manifest.end()

    expect(hash).toMatchInlineSnapshot(
      '"d32068b4913a40558e15c6eb56d9b8973ea53d1a283d2c018cc35259d8881c3b"',
    )
    expect(didChange).toBe(true)
    expect(manifestWriter.value).toEqual(`file\tpackages/core/src/index.ts\thash2\n`)
    expect(diffWriter.value).toEqual(`± changed\tfile\tpackages/core/src/index.ts\n`)
  })

  it('should allow things to be removed', () => {
    const manifestWriter = stringWriter()
    const diffWriter = stringWriter()
    const manifest = new ManifestConstructor(simpleTestManifest, manifestWriter, diffWriter)

    const { hash, didChange } = manifest.end()

    expect(hash).toMatchInlineSnapshot(
      '"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"',
    )
    expect(didChange).toBe(true)
    expect(manifestWriter.value).toEqual(``)
    expect(diffWriter.value).toEqual(`- removed\tfile\tpackages/core/src/index.ts\n`)
  })

  it('should complain if things are added in non alphabetical order', () => {
    const manifestWriter = stringWriter()
    const diffWriter = stringWriter()
    const manifest = new ManifestConstructor(simpleTestManifest, manifestWriter, diffWriter)

    manifest.update('file', 'packages/core/src/index2.ts', 'hash2')

    expect(() => {
      manifest.update('file', 'packages/core/src/index.ts', 'hash2')
    }).toThrow()

    expect(() => {
      manifest.update('afile', 'packages/core/src/index2.ts', 'hash2')
    }).toThrow()
  })
})
