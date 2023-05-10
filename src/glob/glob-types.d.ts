type MatchResult = 'terminal' | 'partial' | 'recursive' | 'none' | 'try-next'

interface Matcher {
  children: Matcher[]
  negating: boolean
  match(entry: LazyEntry, options: MatchOptions): MatchResult
}

type MatchTypes = 'files' | 'dirs' | 'all'
type SymbolicLinkStrategy = 'follow' | 'ignore' | 'match'

interface LazyGlobOptions {
  cwd?: string
  cache?: 'none' | 'normal' | 'reckless'
  dot?: boolean
  ignore?: string[]
  types?: MatchTypes
  expandDirectories?: boolean
  symbolicLinks?: SymbolicLinkStrategy
  absolute?: boolean
}

interface MatchOptions {
  dot: boolean
  types: MatchTypes
  cwd: string
  expandDirectories: boolean
  symbolicLinks: SymbolicLinkStrategy
}

interface LogicalClock {
  time: number
}

type ExpansionAST =
  | {
      type: 'group'
      choices: ExpansionAST[]
    }
  | string
