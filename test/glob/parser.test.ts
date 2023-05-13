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
    } else if (node.type === 'character_class') {
      depth++
      print('negating: ' + node.negating)
      for (const elem of node.inclusions) {
        print('type: ' + elem.type)
        if (elem.type === 'character_class_range') {
          print('startChar: ' + elem.startChar)
          print('endChar: ' + elem.endChar)
        } else if (elem.type === 'character_class_element_literal') {
          print('char: ' + elem.char)
        } else {
          print('class: ' + elem.class)
        }
      }
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
      "src · / · { · steve · } · / · dope",
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

test('character classes', () => {
  expect(parseToString('abc/[xyz]/def')).toMatchInlineSnapshot(`
    "sequence: "abc/[xyz]/def"
      [
        string: "abc"
        separator: "/"
        character_class: "[xyz]"
          negating: false
          type: character_class_element_literal
          char: x
          type: character_class_element_literal
          char: y
          type: character_class_element_literal
          char: z
        separator: "/"
        string: "def"
      ]
    "
  `)

  expect(parseToString('abc/[\\w\\dx]/def')).toMatchInlineSnapshot(`
    "sequence: "abc/[\\\\w\\\\dx]/def"
      [
        string: "abc"
        separator: "/"
        character_class: "[\\\\w\\\\dx]"
          negating: false
          type: character_class_builtin
          class: word
          type: character_class_builtin
          class: digit
          type: character_class_element_literal
          char: x
        separator: "/"
        string: "def"
      ]
    "
  `)

  expect(parseToString('abc/[^0-9]/def')).toMatchInlineSnapshot(`
    "sequence: "abc/[^0-9]/def"
      [
        string: "abc"
        separator: "/"
        character_class: "[^0-9]"
          negating: true
          type: character_class_range
          startChar: 0
          endChar: 9
        separator: "/"
        string: "def"
      ]
    "
  `)

  expect(parseToString('abc/[^a-zA-Z0-9]/def')).toMatchInlineSnapshot(`
    "sequence: "abc/[^a-zA-Z0-9]/def"
      [
        string: "abc"
        separator: "/"
        character_class: "[^a-zA-Z0-9]"
          negating: true
          type: character_class_range
          startChar: a
          endChar: z
          type: character_class_range
          startChar: A
          endChar: Z
          type: character_class_range
          startChar: 0
          endChar: 9
        separator: "/"
        string: "def"
      ]
    "
  `)
})

test('posix character classes', () => {
  expect(parseToString('abc/[[:alpha:]]/def')).toMatchInlineSnapshot(`
    "sequence: "abc/[[:alpha:]]/def"
      [
        string: "abc"
        separator: "/"
        character_class: "[[:alpha:]]"
          negating: false
          type: character_class_builtin
          class: alpha
        separator: "/"
        string: "def"
      ]
    "
  `)
  expect(parseToString('abc/[[:alpha:][:digit:]]/def')).toMatchInlineSnapshot(`
    "sequence: "abc/[[:alpha:][:digit:]]/def"
      [
        string: "abc"
        separator: "/"
        character_class: "[[:alpha:][:digit:]]"
          negating: false
          type: character_class_builtin
          class: alpha
          type: character_class_builtin
          class: digit
        separator: "/"
        string: "def"
      ]
    "
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
      ['src/**/dope[\\w]'],
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
                            RegExpMatcher {
                              "children": [],
                              "negating": false,
                              "source": "^dope[\\w]$",
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
