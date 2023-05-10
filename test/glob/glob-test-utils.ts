import assert from 'assert'
import { vol } from 'memfs'
import { minimatch } from 'minimatch'
import { platform } from 'os'
import { glob } from '../../src/glob/glob.js'
import { dirname, isAbsolute, join } from '../../src/path.js'
import { Dir, File } from '../integration/runIntegrationTests.js'

export function extractDirs(dir: Dir) {
  const result: string[] = []
  const traverse = (path: string[], node: File) => {
    if (!node) return
    if (typeof node === 'string') return
    if (path.length) {
      result.push('/' + path.join('/'))
    }
    for (const [segment, childNode] of Object.entries(node)) {
      traverse([...path, segment], childNode)
    }
  }
  traverse([], dir)
  return result
}

export function extractFiles(dir: Dir) {
  const result: string[] = []
  const traverse = (path: string[], node: File) => {
    if (!node) return
    if (typeof node === 'string') {
      result.push('/' + path.join('/'))
      return
    }
    for (const [segment, childNode] of Object.entries(node)) {
      traverse([...path, segment], childNode)
    }
  }
  traverse([], dir)
  return result
}

export function referenceGlob(paths: string[] | Dir, patterns: string[], options: MatchOptions) {
  if (!Array.isArray(paths)) {
    switch (options.types) {
      case 'dirs':
        paths = extractDirs(paths)
        break
      case 'files':
        paths = extractFiles(paths)
        break
      case 'all':
        paths = [...extractDirs(paths), ...extractFiles(paths)].sort()
        break
      default:
        assert(false)
    }
  }
  if (patterns[0].startsWith('!')) {
    patterns = ['**', ...patterns]
  }
  // todo: if options.dirs then extract dirs from paths
  const result = new Set<string>()
  for (let pattern of patterns) {
    const isNegative = pattern.startsWith('!')
    if (isNegative) {
      pattern = pattern.slice(1)
    }
    if (!isAbsolute(pattern)) {
      pattern = join(options.cwd, pattern)
    }
    const matches = paths.filter((p) => {
      return minimatch(
        p,
        options.expandDirectories || isNegative ? pattern + '{,/**/*}' : pattern,
        {
          dot: options.dot || isNegative,
        },
      )
    })
    if (isNegative) {
      for (const match of matches) {
        result.delete(match)
      }
    } else {
      for (const match of matches) {
        result.add(match)
      }
    }
  }
  return [...result].sort()
}

export const writeDir = (path: string, file: File) => {
  if (typeof file === 'undefined') {
    // ignore
  } else if (typeof file === 'string') {
    // create file
    if (file.startsWith('->')) {
      vol.symlinkSync(file.slice(2), path)
    } else {
      vol.writeFileSync(path, file)
    }
  } else {
    // create dir
    vol.mkdirSync(path, { recursive: true })
    Object.entries(file).forEach(([fileName, file]) => {
      writeDir(join(path, fileName), file)
    })
  }
}

export function makeFiles(paths: string[] | Dir) {
  if (Array.isArray(paths)) {
    for (const path of paths) {
      const dir = dirname(path)
      vol.mkdirSync(dir, { recursive: true })
      vol.writeFileSync(path, 'ok')
      vol.statSync(dir)
      vol.statSync(path)
    }
  } else {
    writeDir('/', paths)
  }
}

export function globCheckingAgainstReference(
  paths: string[] | Dir,
  pattern: string[],
  options: MatchOptions,
) {
  const actual = testGlob(pattern, options)
  const expected = referenceGlob(paths, pattern, options).sort()
  expect(actual).toEqual(expected)
  return actual
}

export const testGlob: typeof glob.sync = (patterns, options) => {
  let actual = glob.sync(patterns, { ...options, cache: 'none' }).sort()
  if (platform() === 'win32') {
    actual = actual.map((a) => a.slice(2))
  }
  return actual
}
