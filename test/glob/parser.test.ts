import { Parser } from '../../src/glob/compile/Parser.js'
import { compileMatcher } from '../../src/glob/compile/compileMatcher.js'
import { expandBraces } from '../../src/glob/compile/expandBraces.js'

const tabs = (n: number) => ' '.repeat(n * 2)
const jsonify = (obj: any) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, start, end, ...others } = obj
  return JSON.stringify(others)
}

const parseToString = (input: string) => {
  const ast = new Parser(input).parseSequence()
  let out = ''
  let depth = -1

  const print = (str: string) => {
    out += tabs(depth) + str + '\n'
  }
  const printAst = (node: Expression) => {
    depth++
    print(`${node.type}: ${JSON.stringify(input.slice(node.start, node.end))}`)
    if (
      node.type === 'string' ||
      node.type === 'wildcard' ||
      node.type === 'recursive_wildcard' ||
      node.type === 'separator'
    ) {
      // noop
    } else if (node.type === 'sequence') {
      depth++
      print('[')
      for (const expression of node.expressions) {
        printAst(expression)
      }
      print(']')
      depth--
    } else if (node.type === 'braces') {
      depth++
      print('{')
      for (const expression of node.options) {
        printAst(expression)
      }
      print('}')
      depth--
    } else if (node.type === 'parens') {
      depth++
      print((node.extGlobPrefix ?? '') + '(')
      for (const expression of node.options) {
        printAst(expression)
      }
      print(')')
      depth--
    } else {
      const { type, start, end, ...others } = node
      print(jsonify(others))
    }

    depth--
  }

  printAst(ast)

  return out
}

test('parser', () => {
  expect(parseToString('bananas/are/cool')).toMatchInlineSnapshot(`
    "sequence: "bananas/are/cool"
      [
        string: "bananas"
        separator: "/"
        string: "are"
        separator: "/"
        string: "cool"
      ]
    "
  `)

  expect(parseToString('bananas/are/{1..3..4}')).toMatchInlineSnapshot(`
    "sequence: "bananas/are/{1..3..4}"
      [
        string: "bananas"
        separator: "/"
        string: "are"
        separator: "/"
        braces: "{1..3..4}"
          {
            range_expansion: "1..3..4"
            {"startNumber":1,"endNumber":4,"pad":0,"step":3}
          }
      ]
    "
  `)
  expect(parseToString('yo/{five,three/thirty,22..9}')).toMatchInlineSnapshot(`
    "sequence: "yo/{five,three/thirty,22..9}"
      [
        string: "yo"
        separator: "/"
        braces: "{five,three/thirty,22..9}"
          {
            string: "five"
            sequence: "three/thirty"
              [
                string: "three"
                separator: "/"
                string: "thirty"
              ]
            range_expansion: "22..9"
            {"startNumber":22,"endNumber":9,"pad":0,"step":1}
          }
      ]
    "
  `)

  expect(parseToString('yo/{a,{b,c,{33..44}}}')).toMatchInlineSnapshot(`
    "sequence: "yo/{a,{b,c,{33..44}}}"
      [
        string: "yo"
        separator: "/"
        braces: "{a,{b,c,{33..44}}}"
          {
            string: "a"
            braces: "{b,c,{33..44}}"
              {
                string: "b"
                string: "c"
                braces: "{33..44}"
                  {
                    range_expansion: "33..44"
                    {"startNumber":33,"endNumber":44,"pad":0,"step":1}
                  }
              }
          }
      ]
    "
  `)
})

test('parens', () => {
  expect(parseToString('(1|)')).toMatchInlineSnapshot(`
    "parens: "(1|)"
      (
        string: "1"
        string: ""
      )
    "
  `)
  expect(parseToString('(|2)')).toMatchInlineSnapshot(`
    "parens: "(|2)"
      (
        string: ""
        string: "2"
      )
    "
  `)
  expect(parseToString('(|)')).toMatchInlineSnapshot(`
    "parens: "(|)"
      (
        string: ""
        string: ""
      )
    "
  `)
  expect(parseToString('(1|2|3)')).toMatchInlineSnapshot(`
    "parens: "(1|2|3)"
      (
        string: "1"
        string: "2"
        string: "3"
      )
    "
  `)

  expect(parseToString('bots/!(dope|*(sheep*))')).toMatchInlineSnapshot(`
    "sequence: "bots/!(dope|*(sheep*))"
      [
        string: "bots"
        separator: "/"
        parens: "!(dope|*(sheep*))"
          !(
            string: "dope"
            parens: "*(sheep*)"
              *(
                sequence: "sheep*"
                  [
                    string: "sheep"
                    wildcard: "*"
                  ]
              )
          )
      ]
    "
  `)

  expect(parseToString('src/steve.txt')).toMatchInlineSnapshot(`
    "sequence: "src/steve.txt"
      [
        string: "src"
        separator: "/"
        string: "steve.txt"
      ]
    "
  `)
})

const renderPath = (path: Expression[], pattern: string) => {
  return path
    .map(({ start, end }) => {
      const str = pattern.slice(start, end)
      return str
    })
    .join(' · ')
}

const testExpandBraces = (pattern: string) => {
  const parser = new Parser(pattern)
  const ast = parser.parseSequence()
  const paths = expandBraces(ast)
  return paths.map((path) => renderPath(path, pattern))
}

test('allPaths', () => {
  expect(testExpandBraces('src/**/dope')).toMatchInlineSnapshot(`
    [
      "src · / · ** · / · dope",
    ]
  `)
  expect(testExpandBraces('src/{michael,james}/hello')).toMatchInlineSnapshot(`
    [
      "src · / · michael · / · hello",
      "src · / · james · / · hello",
    ]
  `)
  expect(testExpandBraces('src/{steve}/dope')).toMatchInlineSnapshot(`
    [
      "src · / · steve · / · dope",
    ]
  `)

  expect(testExpandBraces('src/{steve,pablo/jenny,}/dope')).toMatchInlineSnapshot(`
    [
      "src · / · steve · / · dope",
      "src · / · pablo · / · jenny · / · dope",
      "src · / · dope",
    ]
  `)

  expect(testExpandBraces('src/{steve,pablo/*,}/dope')).toMatchInlineSnapshot(`
    [
      "src · / · steve · / · dope",
      "src · / · pablo · / · * · / · dope",
      "src · / · dope",
    ]
  `)
})

test('the empty string', () => {
  expect(testExpandBraces('')).toMatchInlineSnapshot(`[]`)
})
test('empty braces', () => {
  expect(testExpandBraces('{}')).toMatchInlineSnapshot(`[]`)
  expect(testExpandBraces('abc{}def')).toMatchInlineSnapshot(`
    [
      "abc · def",
    ]
  `)
})
test('empty parens', () => {
  expect(testExpandBraces('()')).toMatchInlineSnapshot(`[]`)
  expect(testExpandBraces('abc()def')).toMatchInlineSnapshot(`
    [
      "abc · def",
    ]
  `)
})

test('leading and trailing separators', () => {
  expect(testExpandBraces('/')).toMatchInlineSnapshot(`
    [
      "/",
    ]
  `)
  expect(testExpandBraces('abc/')).toMatchInlineSnapshot(`
    [
      "abc",
    ]
  `)
  expect(testExpandBraces('/abc')).toMatchInlineSnapshot(`
    [
      "/ · abc",
    ]
  `)
  expect(testExpandBraces('/abc/')).toMatchInlineSnapshot(`
    [
      "/ · abc",
    ]
  `)
  expect(testExpandBraces('abc//')).toMatchInlineSnapshot(`
    [
      "abc",
    ]
  `)
  expect(testExpandBraces('abc///')).toMatchInlineSnapshot(`
    [
      "abc",
    ]
  `)
  expect(testExpandBraces('///abc/def////')).toMatchInlineSnapshot(`
    [
      "/ · abc · / · def",
    ]
  `)
})

test('compileMatcher', () => {
  expect(
    compileMatcher(
      {
        cwd: '/home/users/dgb',
        dot: false,
        expandDirectories: false,
        symbolicLinks: 'follow',
        types: 'all',
      },
      ['src/**/dope'],
      '/',
    ),
  ).toMatchInlineSnapshot(`
    RootMatcher {
      "children": [
        ExactStringMatcher {
          "children": [
            ExactStringMatcher {
              "children": [
                ExactStringMatcher {
                  "children": [
                    ExactStringMatcher {
                      "children": [
                        RecursiveWildcardMatcher {
                          "children": [
                            ExactStringMatcher {
                              "children": [],
                              "negating": false,
                              "pattern": "dope",
                            },
                          ],
                          "negating": false,
                        },
                      ],
                      "negating": false,
                      "pattern": "src",
                    },
                  ],
                  "negating": false,
                  "pattern": "dgb",
                },
              ],
              "negating": false,
              "pattern": "users",
            },
          ],
          "negating": false,
          "pattern": "home",
        },
      ],
      "negating": false,
    }
  `)
})
