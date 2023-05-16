import { getRootDir, cwd as procCwd } from '../cwd.js'
import { resolve } from '../path.js'
import { SortedArraySet } from './SortedArraySet.js'
import { compileMatcher } from './compile/compileMatcher.js'
import { LazyDir } from './fs/LazyDir.js'
import { matchInDir } from './matchInDir.js'

export class LazyGlob {
  /** @type {LogicalClock} */
  #clock = { time: 0 }
  /** @type {Map<string, LazyDir>} */
  #rootDirs = new Map()

  /** @param {string} rootDir */
  #getRootDir(rootDir) {
    const existing = this.#rootDirs.get(rootDir)
    if (existing) return existing
    const dir = new LazyDir(this.#clock, rootDir, 0, false, false)
    this.#rootDirs.set(rootDir, dir)
    return dir
  }

  /**
   * @param {readonly string[]} patterns
   * @param {LazyGlobOptions} [opts]
   */
  sync(patterns, opts) {
    /** @type {LazyGlobOptions['cwd']} */
    const cwd = resolve('./', opts?.cwd ?? procCwd)
    const rootDir = getRootDir(cwd)
    /** @type {LazyGlobOptions['cache']} */
    const cache = opts?.cache ?? 'normal'

    /** @type {MatchOptions} */
    const matchOpts = {
      dot: opts?.dot ?? false,
      types: opts?.types ?? 'files',
      cwd,
      expandDirectories: opts?.expandDirectories ?? false,
      symbolicLinks: opts?.symbolicLinks ?? 'follow',
    }

    const rootMatcher = compileMatcher(
      matchOpts,
      patterns.concat(opts?.ignore?.map((p) => '!' + p) ?? []),
      rootDir,
    )

    if (cache === 'normal') {
      this.#clock.time++
    }

    const result = new SortedArraySet()
    matchInDir(
      cache === 'none'
        ? new LazyDir(this.#clock, rootDir, 0, false, true)
        : this.#getRootDir(rootDir),
      matchOpts,
      rootMatcher,
      result,
    )

    return result.array
  }

  invalidate() {
    this.#clock.time++
  }
}
