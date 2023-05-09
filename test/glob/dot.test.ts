import { vol } from 'memfs'
import { globCheckingAgainstReference, makeFiles } from './glob-test-utils.js'
jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

describe('the "dot" option', () => {
  const paths = [
    '/src/stick.txt',
    '/src/.test/stick.txt',
    '/src/.ignore',
    '/.ignore',
    '/.lazy/manifest',
  ].sort()

  it('ignores dot files when false', () => {
    makeFiles(paths)
    const result = globCheckingAgainstReference(paths, ['**'], {
      cwd: '/',
      expandDirectories: false,
      dot: false,
      types: 'files',
      symbolicLinks: 'follow',
    })

    expect(result).toEqual(['/src/stick.txt'])
  })

  it('ignores dot files in expanded directories', () => {
    makeFiles(paths)
    const result = globCheckingAgainstReference(paths, ['src'], {
      cwd: '/',
      expandDirectories: true,
      dot: false,
      types: 'files',
      symbolicLinks: 'follow',
    })

    expect(result).toEqual(['/src/stick.txt'])
  })

  it('does not ignore dot files when true', () => {
    makeFiles(paths)
    const result = globCheckingAgainstReference(paths, ['**'], {
      cwd: '/',
      expandDirectories: false,
      dot: true,
      types: 'files',
      symbolicLinks: 'follow',
    })

    expect(result).toEqual(paths)
  })

  it('does not ignore dot files when true in expanded dirs', () => {
    makeFiles(paths)
    const result = globCheckingAgainstReference(paths, ['src'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
      symbolicLinks: 'follow',
    })

    expect(result).toEqual(['/src/.ignore', '/src/.test/stick.txt', '/src/stick.txt'])
  })
})
