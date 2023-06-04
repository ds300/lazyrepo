import { Lexer } from '../../src/glob/compile/Lexer.js'

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
