import { compileMatcher } from '../../src/glob/compile/compileMatcher.js'
const printMatcherToString = (matchers: Matcher[]) => {
  return matchers
    .map((matcher: Matcher | null) => {
      const keys = []
      let m = matcher
      while (m) {
        keys.push(m.key)
        m = m.next
      }
      return `${matcher?.negating ? '! ' : ''}${keys.join(' -> ')}`
    })
    .join('\n')
}

const printMatcher = (patterns: string[]) => {
  return printMatcherToString(
    compileMatcher(
      {
        cwd: '/',
        dot: false,
        expandDirectories: false,
        symbolicLinks: 'ignore',
        types: 'files',
      },
      patterns,
      '/',
    ),
  )
}

describe('compileMatcher', () => {
  it('removes redundant dots', () => {
    expect(printMatcher(['./lib/**/*.js'])).toMatchInlineSnapshot(
      `"lib -> ** -> ^(?:(?!^\\.).*)\\.js$"`,
    )

    expect(printMatcher(['./lib/./**/*.js'])).toMatchInlineSnapshot(
      `"lib -> ** -> ^(?:(?!^\\.).*)\\.js$"`,
    )
  })

  it('removes redundant globstars', () => {
    expect(printMatcher(['lib/**/**/**/foo.js'])).toMatchInlineSnapshot(`"lib -> ** -> foo.js"`)
  })

  it('dedupes braces', () => {
    expect(printMatcher(['{foo,bar,foo,bar}/*'])).toMatchInlineSnapshot(`
      "foo -> *
      bar -> *"
    `)
  })

  it('dedupes slashes', () => {
    expect(printMatcher(['foo//bar'])).toMatchInlineSnapshot(`"foo -> bar"`)
    expect(printMatcher(['/foo//bar///'])).toMatchInlineSnapshot(`"foo -> bar"`)
  })

  it('handles escaped chars', () => {
    expect(printMatcher(['chips/bu\\[nk'])).toMatchInlineSnapshot(`"chips -> bu[nk"`)
  })

  it('handles posix character classes', () => {
    expect(printMatcher(['chips/[[:alnum:]]'])).toMatchInlineSnapshot(`"chips -> ^[0-9A-Za-z]$"`)
    expect(printMatcher(['chips/[[:alpha:]]'])).toMatchInlineSnapshot(`"chips -> ^[A-Za-z]$"`)
    expect(printMatcher(['chips/[[:ascii:]]'])).toMatchInlineSnapshot(`"chips -> ^[\\x00-\\x7F]$"`)
    expect(printMatcher(['chips/[[:blank:]]'])).toMatchInlineSnapshot(`"chips -> ^[ \\t]$"`)
    expect(printMatcher(['chips/[[:cntrl:]]'])).toMatchInlineSnapshot(
      `"chips -> ^[\\x00-\\x1F\\x7F]$"`,
    )
    expect(printMatcher(['chips/[[:digit:]]'])).toMatchInlineSnapshot(`"chips -> ^[0-9]$"`)
    expect(printMatcher(['chips/[[:graph:]]'])).toMatchInlineSnapshot(`"chips -> ^[\\x21-\\x7E]$"`)
    expect(printMatcher(['chips/[[:lower:]]'])).toMatchInlineSnapshot(`"chips -> ^[a-z]$"`)
    expect(printMatcher(['chips/[[:print:]]'])).toMatchInlineSnapshot(`"chips -> ^[\\x20-\\x7E]$"`)
    expect(printMatcher(['chips/[[:punct:]]'])).toMatchInlineSnapshot(
      `"chips -> ^[!"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_\`{|}~]$"`,
    )
    expect(printMatcher(['chips/[[:space:]]'])).toMatchInlineSnapshot(`"chips -> ^[\\S]$"`)
    expect(printMatcher(['chips/[[:upper:]]'])).toMatchInlineSnapshot(`"chips -> ^[A-Z]$"`)
    expect(printMatcher(['chips/[[:word:]]'])).toMatchInlineSnapshot(`"chips -> ^[\\w]$"`)
    expect(printMatcher(['chips/[[:xdigit:]]'])).toMatchInlineSnapshot(`"chips -> ^[0-9A-Fa-f]$"`)
  })

  it('handles regular character classes', () => {
    expect(printMatcher(['chips/[a-z]'])).toMatchInlineSnapshot(`"chips -> ^[a-z]$"`)
    expect(printMatcher(['chips/[^\\w,•]'])).toMatchInlineSnapshot(`"chips -> ^[^\\w,\\u2022]$"`)
  })
})
