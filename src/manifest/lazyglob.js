import assert from 'assert'
import micromatch from 'micromatch'
import { basename, isAbsolute, join, normalize } from 'path'
import { readdirSync, statSync } from '../fs.js'
import { hashFile } from './hash.js'

class LogicalClock {
  time = 0
}

/**
 * @typedef {LazyFile | LazyDir} LazyEntry
 */
class LazyFile {
  /** @type {LogicalClock} */
  #clock
  /**
   * @type {string}
   * @readonly
   */
  path
  /**
   * @type {string}
   * @readonly
   */
  name
  /** @type {number} */
  #mtime
  /** @type {number} */
  #size

  /** @type {number} */
  #lastHashTime

  /** @type {number} */
  #lastStatTime

  /** @type {null | string} */
  #_hash

  /**
   * @param {LogicalClock} clock
   * @param {string} path
   * @param {number} mtime
   * @param {number} size
   */
  constructor(clock, path, mtime, size) {
    this.#clock = clock
    this.path = path
    this.name = basename(path)
    this.#mtime = mtime
    this.#size = size

    this.#_hash = null
    this.#lastHashTime = clock.time - 1
    this.#lastStatTime = clock.time
  }

  #updateStat() {
    if (this.#lastStatTime === this.#clock.time) {
      return false
    }
    const stat = statSync(this.path)
    const didChange = this.#mtime !== stat.mtimeMs || this.#size !== stat.size
    this.#mtime = stat.mtimeMs
    this.#size = stat.size
    return didChange
  }

  get hash() {
    if (this.#_hash && this.#clock.time === this.#lastHashTime) {
      return this.#_hash
    }
    const didChange = this.#updateStat()
    if (!this.#_hash || didChange) {
      this.#_hash = hashFile(this.path, this.#size)
      this.#lastHashTime = this.#clock.time
    }
    return this.#_hash
  }
}

class LazyDir {
  /** @type {LogicalClock} */
  #clock
  /**
   * @type {string}
   * @readonly
   */
  path
  /**
   * @type {string}
   * @readonly
   */
  name
  /** @type {number} */
  #mtime

  /** @type {number} */
  #lastListTime

  /** @type {number} */
  #lastStatTime

  /** @type {null | {order: LazyEntry[], byName: Record<string, LazyEntry>}} */
  #_listing

  /**
   * @param {LogicalClock} clock
   * @param {string} path
   * @param {number} mtime
   */
  constructor(clock, path, mtime) {
    this.#clock = clock
    this.path = path
    this.name = basename(path)
    this.#mtime = mtime

    this.#_listing = null
    this.#lastListTime = clock.time - 1
    this.#lastStatTime = clock.time
  }

  #updateStat() {
    if (this.#lastStatTime === this.#clock.time) {
      return false
    }
    const stat = statSync(this.path)
    const didChange = this.#mtime !== stat.mtimeMs
    this.#mtime = stat.mtimeMs
    return didChange
  }

  get listing() {
    if (this.#_listing && this.#clock.time === this.#lastListTime) {
      return this.#_listing
    }
    const didChange = this.#updateStat()
    if (!this.#_listing || didChange) {
      const prevListingByName = this.#_listing?.byName
      this.#_listing = {
        order: [],
        byName: {},
      }

      for (const entry of readdirSync(this.path, { withFileTypes: true })) {
        let result = prevListingByName?.[entry.name]
        if (entry.isDirectory() && (!result || !(result instanceof LazyDir))) {
          const stat = statSync(join(this.path, entry.name))
          result = new LazyDir(this.#clock, join(this.path, entry.name), stat.mtimeMs)
        } else if (entry.isFile() && (!result || !(result instanceof LazyFile))) {
          result = new LazyFile(this.#clock, join(this.path, entry.name), 0, 0)
        }
        // TODO: handle symlinks
        if (result) {
          this.#_listing.order.push(result)
          this.#_listing.byName[entry.name] = result
        }
      }

      this.#lastListTime = this.#clock.time
    }
    return this.#_listing
  }
}

/** @implements {Matcher} */
class RegExpMatcher {
  /**
   * @type {RegExp}
   */
  #pattern

  /**
   * @type {string}
   * @readonly
   */
  source

  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {string} source
   * @param {RegExp} pattern
   * @param {boolean} negating
   */
  constructor(source, pattern, negating) {
    this.source = source
    this.#pattern = pattern
    this.negating = negating
  }

  /** @type {Matcher[]} */
  next = []

  /**
   * @param {LazyEntry} entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(entry, _options) {
    if (this.#pattern.test(entry.name)) {
      return this.next.length === 0 ? 'terminal' : 'partial'
    } else {
      return 'none'
    }
  }
}

/** @implements {Matcher} */
class ExactMatcher {
  /**
   * @type {string}
   * @readonly
   */
  pattern

  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {string} pattern
   * @param {boolean} negating
   */
  constructor(pattern, negating) {
    this.pattern = pattern
    this.negating = negating
  }

  /** @type {Matcher[]} */
  next = []

  /**
   * @param {LazyEntry} entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(entry, _options) {
    if (this.pattern === entry.name) {
      return this.next.length === 0 ? 'terminal' : 'partial'
    } else {
      return 'none'
    }
  }
}

/** @implements {Matcher} */
class WildcardMatcher {
  /** @type {Matcher[]} */
  next = []

  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {boolean} negating
   */
  constructor(negating) {
    this.negating = negating
  }

  /**
   * @param {LazyEntry} entry
   * @param {MatchOptions} options
   * @return {MatchResult}
   */
  match(entry, options) {
    if (entry.name[0] === '.' && !options.dot && !this.negating) {
      return 'none'
    }
    return this.next.length === 0 ? 'terminal' : 'partial'
  }
}

/** @implements {Matcher} */
class RecursiveWildcardMatcher {
  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {boolean} negating
   */
  constructor(negating) {
    this.negating = negating
  }
  /** @type {Matcher[]} */
  next = []
  /**
   * @param {LazyEntry} entry
   * @param {MatchOptions} options
   * @return {MatchResult}
   */
  match(entry, options) {
    const ignore = entry.name[0] === '.' && !options.dot
    if (this.next.length === 0) {
      if (this.negating) return 'terminal'
      return ignore
        ? 'none'
        : options.expandDirectories || entry instanceof LazyFile
        ? 'terminal'
        : 'recursive'
    } else {
      return ignore ? 'try-next' : 'recursive'
    }
  }
}

/** @implements {Matcher} */
class RootMatcher {
  /**
   * @type {boolean}
   * @readonly
   */
  negating = false

  /** @type {Matcher[]} */
  next = []
  /**
   * @param {LazyEntry} _entry
   * @param {MatchOptions} _options
   * @return {MatchResult}
   */
  match(_entry, _options) {
    return 'partial'
  }
}

/**
 *
 * @param {Matcher[]} next
 * @param {boolean} negating
 * @param {boolean} terminal
 * @param {(m: Matcher) => boolean} pred
 */
function findSimpaticoMatcher(next, negating, terminal, pred) {
  for (
    let i = next.length - 1;
    i >= 0 && next[i].negating === negating && terminal === !next[i].next.length;
    i--
  ) {
    const matcher = next[i]
    if (pred(matcher)) {
      return matcher
    }
  }
  return null
}

/**
 *
 * @param {MatchOptions} opts
 * @param {Matcher} prev
 * @param {string} segment
 * @param {boolean} negating
 * @param {boolean} terminal
 * @returns {Matcher}
 */
function compilePathSegment(opts, prev, segment, negating, terminal) {
  if (segment === '**') {
    const existing = findSimpaticoMatcher(
      prev.next,
      negating,
      terminal,
      (m) => m instanceof RecursiveWildcardMatcher,
    )
    if (existing) return existing
    const matcher = new RecursiveWildcardMatcher(negating)
    prev.next.push(matcher)
    return matcher
  }
  if (segment === '*') {
    const existing = findSimpaticoMatcher(
      prev.next,
      negating,
      terminal,
      (m) => m instanceof WildcardMatcher,
    )
    if (existing) return existing
    const matcher = new WildcardMatcher(negating)
    prev.next.push(matcher)
    return matcher
  }
  if (/^[\w-.]+$/.test(segment)) {
    const existing = findSimpaticoMatcher(
      prev.next,
      negating,
      terminal,
      (m) => m instanceof ExactMatcher && m.pattern === segment,
    )
    if (existing) return existing
    const matcher = new ExactMatcher(segment, negating)
    prev.next.push(matcher)
    return matcher
  }

  const existing = findSimpaticoMatcher(
    prev.next,
    negating,
    terminal,
    (m) => m instanceof RegExpMatcher && m.source === segment,
  )
  if (existing) return existing

  const regex = micromatch.makeRe(segment, { dot: opts.dot || negating })
  const matcher = new RegExpMatcher(segment, regex, negating)
  prev.next.push(matcher)
  return matcher
}

/**
 * @param {MatchOptions} opts
 * @param {string[]} patterns
 * @param {string} cwd
 */
function compileMatchers(opts, patterns, cwd) {
  const root = new RootMatcher()

  /**
   * @param {MatchOptions} opts
   * @param {string[]} segments
   * @param {boolean} negating
   */
  function addSegments(opts, segments, negating) {
    let prev = root
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      prev = compilePathSegment(opts, prev, segment, negating, i === segments.length - 1)
    }
  }

  let wasFirst = true
  for (let expansion of patterns
    .map(
      (pattern) => micromatch.braces(pattern, { expand: true }),
      // flatMap doesn't work here because if the string doesn't need expanding it returns a string
      // and then the strings get concatenated for some reason.
    )
    .flat()) {
    const isFirst = wasFirst
    wasFirst = false
    let negating = false
    if (expansion.startsWith('!')) {
      expansion = expansion.slice(1)
      negating = true
      if (isFirst) {
        // negating the first matcher implies a "**/*" above it
        addSegments(opts, [...cwd.split('/').filter(Boolean), '**', '*'], false)
      }
    }
    if (expansion.includes('\\')) {
      expansion = expansion.replace(/\\/g, '/')
    }
    if (!isAbsolute(expansion)) {
      expansion = join(cwd, expansion)
    }
    expansion = normalize(expansion)
    const segments = expansion.split('/').filter(Boolean)
    if (segments.length === 0) {
      continue
    }

    addSegments(opts, segments, negating)
  }

  return root
}

/**
 *
 * @param {LazyDir} dir
 * @param {MatchOptions} options
 * @param {Matcher[]} matchers
 * @param {string[]} [result]
 */
function matchInDir(dir, options, matchers, result = []) {
  for (const child of dir.listing.order) {
    if (options.types === 'dirs' && !(child instanceof LazyDir)) continue
    matchDirEntry(child, options, matchers, result)
  }
  return result
}

/**
 *
 * @param {LazyEntry} entry
 * @param {MatchOptions} options
 * @param {Matcher[]} layers
 * @param {string[]} result
 */
function matchDirEntry(entry, options, layers, result) {
  /**
   * @type {Matcher[]}
   */
  const nextLayers = []
  let didPush = false

  const includeEntry = () => {
    if (!didPush) {
      result.push(entry.path)
      didPush = true
    }
  }

  /** @param {Matcher} matcher */
  function checkLayer(matcher, recursive = false) {
    const match = matcher.match(entry, options)
    switch (match) {
      case 'none':
        break
      case 'partial':
        assert(matcher.next.length)
        nextLayers.unshift(...matcher.next)
        break
      case 'try-next':
      case 'recursive':
        for (let i = matcher.next.length - 1; i >= 0; i--) {
          const stopEarly = checkLayer(matcher.next[i], true)
          if (stopEarly) {
            return true
          }
        }
        if (match !== 'try-next') {
          nextLayers.unshift(matcher)
        }
        if (
          matcher.next.length === 0 &&
          entry instanceof LazyDir &&
          (options.types === 'all' || options.types === 'dirs')
        ) {
          includeEntry()
        }
        break
      case 'terminal':
        if (matcher.negating) {
          // break early
          return true
        }
        if (entry instanceof LazyDir) {
          if (options.expandDirectories) {
            if (recursive) {
              nextLayers.unshift(new WildcardMatcher(false))
            } else {
              nextLayers.unshift(new RecursiveWildcardMatcher(false))
            }
          }
        }

        if (
          options.types === 'all' ||
          (options.types === 'dirs' && entry instanceof LazyDir) ||
          (options.types === 'files' && entry instanceof LazyFile)
        ) {
          includeEntry()
        }

        break
      default:
        throw new Error(`Unknown match type: ${match}`)
    }
  }

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    const stopEarly = checkLayer(layer)
    if (stopEarly) {
      break
    }
  }

  if (nextLayers.length && entry instanceof LazyDir && !nextLayers.every((m) => m.negating)) {
    matchInDir(entry, options, nextLayers, result)
  }

  return result
}

class LazyGlob {
  #clock = new LogicalClock()
  #rootDir = new LazyDir(this.#clock, '/', 0)

  totalTimeElapsed = 0n

  /**
   * @param {string[]} patterns
   * @param {LazyGlobOptions} [opts]
   */
  sync(patterns, opts) {
    /** @type {LazyGlobOptions['cwd']} */
    const cwd = opts?.cwd || process.cwd()
    /** @type {LazyGlobOptions['cache']} */
    const cache = opts?.cache ?? 'normal'

    /** @type {MatchOptions} */
    const matchOpts = {
      dot: opts?.dot ?? false,
      types: opts?.types ?? 'files',
      cwd,
      expandDirectories: opts?.expandDirectories ?? false,
    }

    const start = process.hrtime.bigint()
    const rootMatcher = compileMatchers(
      matchOpts,
      patterns.concat(opts?.ignore?.map((p) => '!' + p) ?? []),
      cwd,
    )

    if (cache === 'normal') {
      this.#clock.time++
    }

    const result = matchDirEntry(
      cache === 'none' ? new LazyDir(this.#clock, '/', 0) : this.#rootDir,
      {
        dot: opts?.dot ?? false,
        types: opts?.types ?? 'files',
        cwd,
        expandDirectories: opts?.expandDirectories ?? false,
      },
      [rootMatcher],
      [],
    )
    this.totalTimeElapsed += process.hrtime.bigint() - start
    return result
  }

  invalidate() {
    this.#clock.time++
  }

  constructor() {
    process.on('exit', () => {
      // console.log(`Total time spent in glob: ${this.totalTimeElapsed / 1000000n} ms`)
    })
  }
}

export const glob = new LazyGlob()
