import { vol } from 'memfs'
import { glob } from '../../src/glob/glob.js'
import { Dir } from '../integration/runIntegrationTests.js'
import { writeDir } from './glob-test-utils.js'

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

describe('the "types" option', () => {
  const dir: Dir = {
    src: {
      utils: {
        'index.js': '->/lib/index.js',
      },
      test: '->/_test',
      'not_a_link.txt': 'ok',
    },
    lib: {
      'index.js': 'ok',
    },
    _test: {
      'thing.test.ts': 'ok',
    },
  }

  beforeEach(() => {
    writeDir('/', dir)
  })

  it('should follow symlinks by default', () => {
    const result = glob
      .sync(['**'], {
        cwd: '/src',
      })
      .sort()

    expect(result).toMatchInlineSnapshot(`
      [
        "/src/not_a_link.txt",
        "/src/test/thing.test.ts",
        "/src/utils/index.js",
      ]
    `)
  })

  it('will ignore symlinks if told to', () => {
    const result = glob
      .sync(['**'], {
        cwd: '/src',
        symbolicLinks: 'ignore',
      })
      .sort()

    expect(result).toMatchInlineSnapshot(`[]`)
  })

  it('will match symlinks but not traverse them if told to', () => {
    const filesResult = glob
      .sync(['**'], {
        cwd: '/src',
        symbolicLinks: 'match',
      })
      .sort()

    expect(filesResult).toMatchInlineSnapshot(`
      [
        "/src/not_a_link.txt",
        "/src/utils/index.js",
      ]
    `)

    const dirsResult = glob
      .sync(['**'], {
        cwd: '/src',
        symbolicLinks: 'match',
        types: 'dirs',
      })
      .sort()

    expect(dirsResult).toMatchInlineSnapshot(`
      [
        "/src/test",
        "/src/utils",
      ]
    `)
  })
})
