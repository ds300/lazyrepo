import { vol } from 'memfs'
import { makeFiles, testGlob } from './glob-test-utils.js'

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

describe('negation', () => {
  it('works', () => {
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
    expect(testGlob(['src/!(dist)/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
        "/src/lib/bulb.txt",
      ]
    `)
    expect(testGlob(['src/!(dist|lib)/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
      ]
    `)
    expect(testGlob(['src/!(dist|+([[:digit:]]))/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/lib/bulb.txt",
      ]
    `)
    expect(testGlob(['src/!(+([[:alpha:]]))/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
      ]
    `)
  })
})

describe('star', () => {
  it('works', () => {
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

    expect(testGlob(['src/*([[:alpha:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/dist/bulb.txt",
        "/src/lib/bulb.txt",
      ]
    `)
    expect(testGlob(['src/*([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
      ]
    `)
    expect(testGlob(['src/*([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
          [
            "/src/234/bulb.txt",
          ]
      `)
    expect(testGlob(['src/dist*([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/dist/bulb.txt",
      ]
    `)
  })
})

describe('plus', () => {
  it('works', () => {
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

    expect(testGlob(['src/+([[:alpha:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/dist/bulb.txt",
        "/src/lib/bulb.txt",
      ]
    `)
    expect(testGlob(['src/+([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
      ]
    `)
    expect(testGlob(['src/+([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
          [
            "/src/234/bulb.txt",
          ]
      `)
    expect(testGlob(['src/dist+([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`[]`)
  })
})

describe('question', () => {
  it('works', () => {
    makeFiles({
      src: {
        '234': {
          'bulb.txt': 'ok',
        },
      },
    })

    expect(testGlob(['src/?([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`[]`)
    expect(testGlob(['src/2?([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`[]`)
    expect(testGlob(['src/23?([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
      ]
    `)
    expect(testGlob(['src/234?([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
      ]
    `)
    expect(testGlob(['src/2345?([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`[]`)
  })
})

describe('at', () => {
  it('works', () => {
    makeFiles({
      src: {
        '234': {
          'bulb.txt': 'ok',
        },
      },
    })

    expect(testGlob(['src/@([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`[]`)
    expect(testGlob(['src/2@([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`[]`)
    expect(testGlob(['src/23@([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`
      [
        "/src/234/bulb.txt",
      ]
    `)
    expect(testGlob(['src/234@([[:digit:]])/*'], { cwd: '/' })).toMatchInlineSnapshot(`[]`)
  })
})
