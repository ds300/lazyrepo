import { vol } from 'memfs'
import { makeFiles, testGlob } from './glob-test-utils.js'

// * and ** are tested by glob-random.test.ts

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

describe('?', () => {
  it('works', () => {
    makeFiles({
      'a.txt': 'ok',
      'b.txt': 'ok',
      'cd.txt': 'ok',
    })
    expect(testGlob(['?.txt'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/a.txt",
        "/b.txt",
      ]
    `)

    expect(testGlob(['cd?txt'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/cd.txt",
      ]
    `)
  })
})
