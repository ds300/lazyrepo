interface ASTNode {
  start: number
  end: number
  source: string
}
interface StringNode extends ASTNode {
  type: 'string'
  value: string
}

type Expression =
  | Sequence
  | StringNode
  | Braces
  | Parens
  | RecursiveWildcard
  | Wildcard
  | CharacterClass
  | Separator
  | RangeExpansion

interface Sequence extends ASTNode {
  type: 'sequence'
  expressions: Expression[]
}

interface Wildcard extends ASTNode {
  type: 'wildcard'
  wildcardType: '*' | '?'
}
interface RecursiveWildcard extends ASTNode {
  type: 'recursive_wildcard'
}

interface RangeExpansion extends ASTNode {
  type: 'range_expansion'
  startNumber: number
  endNumber: number
  step: number
  pad: number
}

interface Braces extends ASTNode {
  type: 'braces'
  options: Expression[]
}

interface Parens extends ASTNode {
  type: 'parens'
  extGlobPrefix: '!' | '+' | '*' | '@' | '?' | null
  options: Expression[]
}

type BraceExpression = Expression | RangeExpansion

interface ParenSwitch extends ASTNode {
  type: 'paren_switch'
  expressions: Expression[]
}

interface Separator extends ASTNode {
  type: 'separator'
}

interface CharacterClass extends ASTNode {
  type: 'character_class'
  negating: boolean
  inclusions: CharacterClassElement[]
}

type CharacterClassElement =
  | CharacterClassRange
  | CharacterClassElementLiteral
  | CharacterClassBuiltinClass

interface CharacterClassRange extends ASTNode {
  type: 'character_class_range'
  startChar: string
  endChar: string
}

interface CharacterClassElementLiteral extends ASTNode {
  type: 'character_class_element_literal'
  char: string
}

interface CharacterClassBuiltinClass extends ASTNode {
  type: 'character_class_builtin'
  class:
    | 'alnum'
    | 'alpha'
    | 'ascii'
    | 'blank'
    | 'cntrl'
    | 'digit'
    | 'graph'
    | 'lower'
    | 'print'
    | 'punct'
    | 'space'
    | 'upper'
    | 'word'
    | 'xdigit'
    | 'not_word'
    | 'not_digit'
    | 'not_space'
}
