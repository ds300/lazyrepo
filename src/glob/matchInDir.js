import assert from 'assert'
import { LazyDir } from './fs/LazyDir.js'
import { LazyFile } from './fs/LazyFile.js'
import { RecursiveWildcardMatcher } from './matchers/RecursiveWildcardMatcher.js'
import { WildcardMatcher } from './matchers/WildcardMatcher.js'

/**
 *
 * @param {LazyDir} dir
 * @param {MatchOptions} options
 * @param {Matcher[]} matchers
 * @param {string[]} [result]
 */
export function matchInDir(dir, options, matchers, result = []) {
  for (const child of dir.listing.order) {
    if (options.types === 'dirs' && !(child instanceof LazyDir)) continue
    matchDirEntry(child, options, matchers, result)
  }
  return result
}

/**
 *
 * @param {import("./fs/LazyEntry.js").LazyEntry} entry
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
