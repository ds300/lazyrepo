interface ASTNode {
  start: number
  end: number
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
  | ExtGlobSwitch
  | Wildcard
  | CharacterClass
  | Separator
  | RangeExpansion
  | NegatedExpression

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
type ExtGlobExpression = Array<ExtGlobSwitch | Wildcard | StringNode>
type ExtGlobSwitch = {
  type: 'ext_glob_switch'
  prefix: '!' | '+' | '*' | '@' | '?'
  options: ExtGlobExpression[]
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
  options: BraceExpression[]
}

interface Parens extends ASTNode {
  type: 'parens'
  extGlobPrefix: '!' | '+' | '*' | '@' | '?' | null
  options: Expression[]
}

type BraceExpression = Expression | NumberRange

interface NumberRange extends ASTNode {
  type: 'number_range'
  start: number
  end: number
  stepSize: number
}

interface ParenSwitch extends ASTNode {
  type: 'paren_switch'
  expressions: Expression[]
}

interface NegatedExpression extends ASTNode {
  type: 'negated_expression'
  expression: Expression
}

interface Separator extends ASTNode {
  type: 'separator'
}

interface CharacterClass extends ASTNode {
  type: 'character_class'
  source: string
}
