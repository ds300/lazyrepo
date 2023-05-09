import { vol } from 'memfs'
import { glob } from '../../src/glob/glob.js'
import { makeFiles } from './glob-test-utils.js'

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
    glob.sync(['src/!dist/*'], {
      cwd: '/',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/src/234/bulb.txt",
      "/src/lib/bulb.txt",
    ]
  `)

  expect(glob.sync(['src/[[:digit:]][[:digit:]][[:digit:]]/*'], { cwd: '/' }))
    .toMatchInlineSnapshot(`
    [
      "/src/234/bulb.txt",
    ]
  `)
})
