import { vol } from 'memfs'
import { Dir } from '../integration/runIntegrationTests.js'
import { globCheckingAgainstReference, writeDir } from './glob-test-utils.js'

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

describe('negation layers', () => {
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

  it('if the first pattern is a negation, it implies that all files are included to start', () => {
    const result = globCheckingAgainstReference(dir, ['!src'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
      symbolicLinks: 'follow',
    })

    expect(result).toMatchInlineSnapshot(`
      [
        "/.gitignore",
        "/.lazy/manifest",
        "/lib/index.js",
        "/package.json",
      ]
    `)
  })

  it('allows things to be included after they have been excluded', () => {
    const result = globCheckingAgainstReference(dir, ['!src', 'src/utils'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
      symbolicLinks: 'follow',
    })

    expect(result).toMatchInlineSnapshot(`
      [
        "/.gitignore",
        "/.lazy/manifest",
        "/lib/index.js",
        "/package.json",
        "/src/utils/index.js",
      ]
    `)
  })

  it('allows multiple levels of inclusion and exclusion', () => {
    const result = globCheckingAgainstReference(dir, ['src', '!src/utils', '!.*', '.lazy'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'all',
      symbolicLinks: 'follow',
    })

    expect(result).toMatchInlineSnapshot(`
      [
        "/.lazy",
        "/.lazy/manifest",
        "/src",
        "/src/.test",
        "/src/.test/index.test.js",
        "/src/banana.js",
        "/src/bubbles.js",
      ]
    `)
  })
})
