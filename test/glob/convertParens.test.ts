import { vol } from 'memfs'
import { convertParens } from '../../src/glob/convertParens.js'
import { makeFiles, testGlob } from './glob-test-utils.js'

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

describe('convertParens', () => {
  it('should convert parens to braces', () => {
    expect(convertParens('(a|b)')).toMatchInlineSnapshot(`"{a,b}"`)

    expect(convertParens('(foo|bar|baz)')).toMatchInlineSnapshot(`"{foo,bar,baz}"`)

    expect(convertParens("(foo chips|bar hello|baz o'clock)")).toMatchInlineSnapshot(
      `"{foo chips,bar hello,baz o'clock}"`,
    )
  })

  it('should work with nested parens', () => {
    expect(convertParens('(a|(b|c))')).toMatchInlineSnapshot(`"{a,{b,c}}"`)

    expect(convertParens('(a|(b|c)|d)')).toMatchInlineSnapshot(`"{a,{b,c},d}"`)

    expect(convertParens('(a|(b|c)|d|(e|f))')).toMatchInlineSnapshot(`"{a,{b,c},d,{e,f}}"`)
  })

  it('should leave braces untouched', () => {
    expect(convertParens('{a,b}')).toMatchInlineSnapshot(`"{a,b}"`)

    expect(convertParens('{a,(b|c)}')).toMatchInlineSnapshot(`"{a,{b,c}}"`)
  })

  it('should work in the middle of path strings', () => {
    expect(convertParens('src/(foo|bar|baz)')).toMatchInlineSnapshot(`"src/{foo,bar,baz}"`)

    expect(convertParens("src/(foo chips|bar hello|baz o'clock)/funk")).toMatchInlineSnapshot(
      `"src/{foo chips,bar hello,baz o'clock}/funk"`,
    )
  })

  it('allows escaping parens with a backslash', () => {
    expect(convertParens('foo\\(bar|baz)')).toMatchInlineSnapshot(`"foo\\(bar|baz)"`)
    expect(convertParens('foo\\bar\\(bar|baz)')).toMatchInlineSnapshot(`"foo\\bar\\(bar|baz)"`)
  })

  it('throws an error for unclosed paren', () => {
    expect(() => convertParens('f(oo(bar|baz)')).toThrowErrorMatchingInlineSnapshot(
      `"Unterminated group in pattern: 'f(oo(bar|baz)'"`,
    )
    expect(() => convertParens('foo(bar|baz')).toThrowErrorMatchingInlineSnapshot(
      `"Unterminated group in pattern: 'foo(bar|baz'"`,
    )
  })

  it('works for multi-segment patterns inside parens', () => {
    expect(convertParens('foo/(bar/foo|baz/bar/chips)')).toMatchInlineSnapshot(
      `"foo/{bar/foo,baz/bar/chips}"`,
    )
  })

  it('works for empty strings', () => {
    expect(convertParens('foo/(chips/|)')).toMatchInlineSnapshot(`"foo/{chips/,}"`)
    expect(convertParens('foo/bar/(|baz)')).toMatchInlineSnapshot(`"foo/bar/{,baz}"`)
  })
})

test('multi-segment parens work in glob.sync', () => {
  makeFiles({
    src: {
      dist: {
        'bulb.txt': 'ok',
      },
      lib: {
        'bulb.txt': 'ok',
      },
      '234': {
        'tree.txt': 'ok',
      },
    },
  })
  expect(
    testGlob(['src/(dist/bulb*|lib/bulb.txt)'], {
      cwd: '/',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/src/dist/bulb.txt",
      "/src/lib/bulb.txt",
    ]
  `)

  expect(testGlob(['(src/lib|src/2*)/*.txt'], { cwd: '/' })).toMatchInlineSnapshot(`
    [
      "/src/234/tree.txt",
      "/src/lib/bulb.txt",
    ]
  `)
})
