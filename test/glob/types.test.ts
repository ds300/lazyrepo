import { vol } from 'memfs'
import { Dir } from '../integration/runIntegrationTests.js'
import { globCheckingAgainstReference, writeDir } from './glob-test-utils.js'

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

describe('the "types" option', () => {
  const dir: Dir = {
    src: {
      'banana.js': 'ok',
      'bubbles.js': 'ok',
      utils: {
        'index.js': 'ok',
      },
      '.test': {
        'index.test.js': 'ok',
      },
    },
    lib: {
      'index.js': 'ok',
    },
    'package.json': 'ok',
    '.gitignore': 'ok',
    '.lazy': {
      manifest: 'ok',
    },
  }
  beforeEach(() => {
    writeDir('/', dir)
  })

  it('should return only files when "files" is passed', () => {
    const result = globCheckingAgainstReference(dir, ['**'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
      symbolicLinks: 'follow',
    })

    expect(result).toEqual([
      '/.gitignore',
      '/.lazy/manifest',
      '/lib/index.js',
      '/package.json',
      '/src/.test/index.test.js',
      '/src/banana.js',
      '/src/bubbles.js',
      '/src/utils/index.js',
    ])
  })

  it('should return only dirs when "dirs" is passed', () => {
    const result = globCheckingAgainstReference(dir, ['**'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'dirs',
      symbolicLinks: 'follow',
    })

    expect(result).toEqual(['/.lazy', '/lib', '/src', '/src/.test', '/src/utils'])
  })

  it('should return both files and dirs when "all" is passed', () => {
    const result = globCheckingAgainstReference(dir, ['**'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'all',
      symbolicLinks: 'follow',
    })

    expect(result).toEqual([
      '/.gitignore',
      '/.lazy',
      '/.lazy/manifest',
      '/lib',
      '/lib/index.js',
      '/package.json',
      '/src',
      '/src/.test',
      '/src/.test/index.test.js',
      '/src/banana.js',
      '/src/bubbles.js',
      '/src/utils',
      '/src/utils/index.js',
    ])
  })
})
