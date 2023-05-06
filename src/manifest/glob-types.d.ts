type MatchResult = 'terminal' | 'partial' | 'recursive' | 'none' | 'try-next'

interface Matcher {
  next: Matcher[]
  negating: boolean
  match(entry: LazyEntry, options: MatchOptions): MatchResult
}

interface LazyGlobOptions {
  cwd?: string
  cache?: 'none' | 'normal' | 'reckless'
  dot?: boolean
  ignore?: string[]
  types?: 'files' | 'dirs'
}

interface MatchOptions {
  dot: boolean
  types: 'files' | 'dirs'
  cwd: string
}
