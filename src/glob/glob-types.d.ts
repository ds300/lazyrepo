type MatchResult = 'terminal' | 'partial' | 'recursive' | 'none' | 'try-next'

interface Matcher {
  next: Matcher[]
  negating: boolean
  match(entry: LazyEntry, options: MatchOptions): MatchResult
}

type MatchTypes = 'files' | 'dirs' | 'all'

interface LazyGlobOptions {
  cwd?: string
  cache?: 'none' | 'normal' | 'reckless'
  dot?: boolean
  ignore?: string[]
  types?: MatchTypes
  expandDirectories?: boolean
}

interface MatchOptions {
  dot: boolean
  types: MatchTypes
  cwd: string
  expandDirectories: boolean
}

interface LogicalClock {
  time: number
}

