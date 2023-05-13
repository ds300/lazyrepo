import { vol } from 'memfs'
import { makeFiles, testGlob } from './glob-test-utils.js'

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

test('advanced syntax provided by micromatch works', () => {
  makeFiles({
    src: {
      dist: {
        'bulb.txt': 'ok',
      },
      lib: {
        'bulb.txt': 'ok',
      },
      '234': {
        'bulb.txt': 'ok',
      },
    },
  })
  expect(
    testGlob(['src/!(dist)/*'], {
      cwd: '/',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/src/234/bulb.txt",
      "/src/lib/bulb.txt",
    ]
  `)

  expect(testGlob(['src/[[:digit:]][[:digit:]][[:digit:]]/*'], { cwd: '/' }))
    .toMatchInlineSnapshot(`
    [
      "/src/234/bulb.txt",
    ]
  `)
})
