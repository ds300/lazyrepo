type MatchResult =
  | 'terminal'
  | 'none'
  // partial match, go down
  | 'next'
  | 'recur'
  | 'try-next'

interface Matcher {
  key: string
  next: Matcher | null
  negating: boolean
  match: MatchFn
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

type MatchFn = (entry: { name: string }, options: MatchOptions, matcher: Matcher) => MatchResult
