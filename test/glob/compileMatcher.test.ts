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
  it('works', () => {
    expect(printMatcher(['lib/!(**)/*'])).toMatchInlineSnapshot(`"lib -> ^(?!(.*)$).*$ -> *"`)
    expect(printMatcher(['/!(stuff)'])).toMatchInlineSnapshot(`"^(?!(stuff)$).*$"`)
    expect(printMatcher(['/!(*(*))'])).toMatchInlineSnapshot(`"^(?!((.*)*)$).*$"`)
  })
})
