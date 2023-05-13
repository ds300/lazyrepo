import { Lexer } from '../../src/glob/compile/Lexer.js'
import { Parser } from '../../src/glob/compile/Parser.js'

const testLex = (input: string) => {
  const result = []
  const lex = new Lexer(input)
  while (lex.hasMoreTokens()) {
    result.push(lex.nextToken())
  }
  return result
}

test('it works with stuff', () => {
  expect(testLex('src/**/*.js')).toMatchInlineSnapshot(`
    [
      "src",
      Symbol(/),
      Symbol(*),
      Symbol(*),
      Symbol(/),
      Symbol(*),
      Symbol(.),
      "js",
    ]
  `)

  expect(testLex('!banana/{32,23..32}bananas.txt')).toMatchInlineSnapshot(`
    [
      Symbol(!),
      "banana",
      Symbol(/),
      Symbol({),
      "32",
      Symbol(,),
      "23",
      Symbol(..),
      "32",
      Symbol(}),
      "bananas",
      Symbol(.),
      "txt",
    ]
  `)

  expect(testLex('()|*?+./[]!{},@')).toMatchInlineSnapshot(`
    [
      Symbol((),
      Symbol()),
      Symbol(|),
      Symbol(*),
      Symbol(?),
      Symbol(+),
      Symbol(.),
      Symbol(/),
      Symbol([),
      Symbol(]),
      Symbol(!),
      Symbol({),
      Symbol(}),
      Symbol(,),
      Symbol(@),
    ]
  `)
})

test('escaping works', () => {
  expect(testLex('src/**/\\*\\*/*.js')).toMatchInlineSnapshot(`
    [
      "src",
      Symbol(/),
      Symbol(*),
      Symbol(*),
      Symbol(/),
      "*",
      "*",
      Symbol(/),
      Symbol(*),
      Symbol(.),
      "js",
    ]
  `)
})

const testParse = (input: string) => {
  return new Parser(input).parseSequence()
}

test('parser', () => {
  expect(testParse('bananas/are/cool')).toMatchInlineSnapshot(`
    {
      "end": 16,
      "expressions": [
        {
          "end": 7,
          "start": 0,
          "type": "string",
          "value": "bananas",
        },
        {
          "end": 8,
          "start": 7,
          "type": "separator",
        },
        {
          "end": 11,
          "start": 8,
          "type": "string",
          "value": "are",
        },
        {
          "end": 12,
          "start": 11,
          "type": "separator",
        },
        {
          "end": 16,
          "start": 12,
          "type": "string",
          "value": "cool",
        },
      ],
      "start": 0,
      "type": "sequence",
    }
  `)

  expect(testParse('bananas/are/{1..3..4}')).toMatchInlineSnapshot(`
    {
      "end": 21,
      "expressions": [
        {
          "end": 7,
          "start": 0,
          "type": "string",
          "value": "bananas",
        },
        {
          "end": 8,
          "start": 7,
          "type": "separator",
        },
        {
          "end": 11,
          "start": 8,
          "type": "string",
          "value": "are",
        },
        {
          "end": 12,
          "start": 11,
          "type": "separator",
        },
        {
          "end": 21,
          "options": [
            {
              "end": 20,
              "endNumber": 4,
              "pad": 0,
              "start": 13,
              "startNumber": 1,
              "step": 3,
              "type": "range_expansion",
            },
          ],
          "start": 12,
          "type": "braces",
        },
      ],
      "start": 0,
      "type": "sequence",
    }
  `)
  expect(testParse('yo/{five,three/thirty,22..9}')).toMatchInlineSnapshot(`
    {
      "end": 28,
      "expressions": [
        {
          "end": 2,
          "start": 0,
          "type": "string",
          "value": "yo",
        },
        {
          "end": 3,
          "start": 2,
          "type": "separator",
        },
        {
          "end": 28,
          "options": [
            {
              "end": 8,
              "expressions": [
                {
                  "end": 8,
                  "start": 4,
                  "type": "string",
                  "value": "five",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
            {
              "end": 21,
              "expressions": [
                {
                  "end": 14,
                  "start": 9,
                  "type": "string",
                  "value": "three",
                },
                {
                  "end": 15,
                  "start": 14,
                  "type": "separator",
                },
                {
                  "end": 21,
                  "start": 15,
                  "type": "string",
                  "value": "thirty",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
            {
              "end": 27,
              "endNumber": 9,
              "pad": 0,
              "start": 22,
              "startNumber": 22,
              "step": 1,
              "type": "range_expansion",
            },
          ],
          "start": 3,
          "type": "braces",
        },
      ],
      "start": 0,
      "type": "sequence",
    }
  `)

  expect(testParse('yo/{a,{b,c,{33..44}}}')).toMatchInlineSnapshot(`
    {
      "end": 21,
      "expressions": [
        {
          "end": 2,
          "start": 0,
          "type": "string",
          "value": "yo",
        },
        {
          "end": 3,
          "start": 2,
          "type": "separator",
        },
        {
          "end": 21,
          "options": [
            {
              "end": 5,
              "expressions": [
                {
                  "end": 5,
                  "start": 4,
                  "type": "string",
                  "value": "a",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
            {
              "end": 20,
              "expressions": [
                {
                  "end": 20,
                  "options": [
                    {
                      "end": 8,
                      "expressions": [
                        {
                          "end": 8,
                          "start": 7,
                          "type": "string",
                          "value": "b",
                        },
                      ],
                      "start": 0,
                      "type": "sequence",
                    },
                    {
                      "end": 10,
                      "expressions": [
                        {
                          "end": 10,
                          "start": 9,
                          "type": "string",
                          "value": "c",
                        },
                      ],
                      "start": 0,
                      "type": "sequence",
                    },
                    {
                      "end": 19,
                      "expressions": [
                        {
                          "end": 19,
                          "options": [
                            {
                              "end": 18,
                              "endNumber": 44,
                              "pad": 0,
                              "start": 12,
                              "startNumber": 33,
                              "step": 1,
                              "type": "range_expansion",
                            },
                          ],
                          "start": 11,
                          "type": "braces",
                        },
                      ],
                      "start": 0,
                      "type": "sequence",
                    },
                  ],
                  "start": 6,
                  "type": "braces",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
          ],
          "start": 3,
          "type": "braces",
        },
      ],
      "start": 0,
      "type": "sequence",
    }
  `)
})

test('parens', () => {
  expect(testParse('(1|2|3)')).toMatchInlineSnapshot(`
    {
      "end": 7,
      "expressions": [
        {
          "end": 7,
          "extGlobPrefix": null,
          "options": [
            {
              "end": 2,
              "expressions": [
                {
                  "end": 2,
                  "start": 1,
                  "type": "string",
                  "value": "1",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
            {
              "end": 4,
              "expressions": [
                {
                  "end": 4,
                  "start": 3,
                  "type": "string",
                  "value": "2",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
            {
              "end": 6,
              "expressions": [
                {
                  "end": 6,
                  "start": 5,
                  "type": "string",
                  "value": "3",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
          ],
          "start": 0,
          "type": "parens",
        },
      ],
      "start": 0,
      "type": "sequence",
    }
  `)

  expect(testParse('bots/!(dope|*(sheep/**))')).toMatchInlineSnapshot(`
    {
      "end": 24,
      "expressions": [
        {
          "end": 4,
          "start": 0,
          "type": "string",
          "value": "bots",
        },
        {
          "end": 5,
          "start": 4,
          "type": "separator",
        },
        {
          "end": 24,
          "extGlobPrefix": "!",
          "options": [
            {
              "end": 11,
              "expressions": [
                {
                  "end": 11,
                  "start": 7,
                  "type": "string",
                  "value": "dope",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
            {
              "end": 23,
              "expressions": [
                {
                  "end": 23,
                  "extGlobPrefix": "*",
                  "options": [
                    {
                      "end": 22,
                      "expressions": [
                        {
                          "end": 19,
                          "start": 14,
                          "type": "string",
                          "value": "sheep",
                        },
                        {
                          "end": 20,
                          "start": 19,
                          "type": "separator",
                        },
                        {
                          "end": 22,
                          "start": 20,
                          "type": "recursive_wildcard",
                        },
                      ],
                      "start": 0,
                      "type": "sequence",
                    },
                  ],
                  "start": 13,
                  "type": "parens",
                },
              ],
              "start": 0,
              "type": "sequence",
            },
          ],
          "start": 6,
          "type": "parens",
        },
      ],
      "start": 0,
      "type": "sequence",
    }
  `)
})
