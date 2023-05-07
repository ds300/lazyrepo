/* eslint-disable jest/expect-expect */
import { vol } from 'memfs'
import { minimatch } from 'minimatch'
import { dirname, isAbsolute, join } from 'path'
import { glob } from '../src/manifest/lazyglob.js'
import { Random } from './test-utils.js'

jest.mock('../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

type Tree = 'ok' | { [key: string]: Tree }

const FILE_NAMES = ['jeff', 'bulb', 'stove', 'banana', 'stick'] as const
const EXTENSIONS = ['.js', '.ts', '.json', '.md', '.txt'] as const
const DIR_NAMES = ['src', 'lib', 'dist', 'node_modules'] as const
class Source extends Random {
  getRandomFileName(): string {
    return this.execOneOf([
      () => this.useOneOf(FILE_NAMES),
      () => this.useOneOf(FILE_NAMES) + this.useOneOf(EXTENSIONS),
      () => this.useOneOf(FILE_NAMES) + '-' + this.useOneOf(FILE_NAMES),
      () => this.useOneOf(FILE_NAMES) + '-' + this.useOneOf(FILE_NAMES) + this.useOneOf(EXTENSIONS),
    ])
  }

  getRandomDirName(): string {
    const name = this.execOneOf<string>([
      () => this.useOneOf(DIR_NAMES),
      () => this.useOneOf(DIR_NAMES) + '-' + this.useOneOf(DIR_NAMES),
      () => this.useOneOf(DIR_NAMES) + '_' + this.useOneOf(DIR_NAMES),
    ])

    if (this.random(10) === 0) {
      // 10% chance of adding a dot
      return '.' + name
    }
    return name
  }

  getRandomPath(): string {
    const numSegments = this.random(4) + 1

    const segments = []
    for (let i = 0; i < numSegments - 1; i++) {
      segments.push(this.getRandomDirName())
    }
    segments.push(this.getRandomFileName())
    return '/' + segments.join('/')
  }

  getRandomTree(): Tree {
    const result: Tree = {}
    const numFiles = this.random(10)
    for (let i = 0; i < numFiles; i++) {
      const path = this.getRandomPath().split('/').filter(Boolean)
      let node: Exclude<Tree, string> = result
      for (const segment of path.slice(0, -1)) {
        if (typeof node[segment] !== 'object') {
          node[segment] = {}
        }
        node = node[segment] as Exclude<Tree, string>
      }
      node[path[path.length - 1]] = 'ok'
    }
    return result
  }

  getRandomPaths(): string[] {
    const tree = this.getRandomTree()
    const result: string[] = []
    const traverse = (path: string[], node: Tree) => {
      if (node === 'ok') {
        result.push('/' + path.join('/'))
        return
      }
      for (const [segment, childNode] of Object.entries(node)) {
        traverse([...path, segment], childNode)
      }
    }
    traverse([], tree)
    return result
  }

  getRandomPattern(): string {
    const absolute = this.random(4) === 0

    const numParts = this.random(4) + 1

    const parts = []
    for (let i = 0; i < numParts; i++) {
      parts.push(this.getRandomPatternSegment())
    }
    let result = parts.join('/')
    if (absolute) {
      result = '/' + result
    }
    return result
  }

  getRandomPatternSegment(depth = 2): any {
    return this.execOneOf([
      () => '*',
      () => '**',
      () => this.getRandomDirName(),
      () => this.getRandomDirName().replace(/-\w+/, '*'),
      () => this.getRandomDirName().replace(/\w+-/, '*'),
      () => this.getRandomFileName(),
      () => this.getRandomFileName().replace(/-\w+/, '*'),
      () => this.getRandomFileName().replace(/\w+-/, '*'),
      () => {
        if (depth === 0) {
          return '**'
        }
        const numSubPatterns = this.random(3) + 1
        const parts = []
        for (let i = 0; i < numSubPatterns; i++) {
          parts.push(this.getRandomPatternSegment(depth - 1))
        }
        return `{${parts.join(',')}}`
      },
    ])
  }

  randomDirFromPaths(paths: string[]): string {
    if (paths.length === 0) {
      return '/'
    }
    const parts = this.useOneOf(paths).split('/').filter(Boolean)

    return '/' + parts.slice(0, this.random(parts.length)).join('/')
  }
}

function referenceGlob(paths: string[], patterns: string[], options: MatchOptions) {
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
      return minimatch(p, options.expandDirectories ? pattern + '{,/**}' : pattern, { dot: false })
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

function makeFiles(paths: string[]) {
  for (const path of paths) {
    const dir = dirname(path)
    vol.mkdirSync(dir, { recursive: true })
    vol.writeFileSync(path, 'ok')
    vol.statSync(dir)
    vol.statSync(path)
  }
}

function both(paths: string[], pattern: string[], options: MatchOptions) {
  const actual = glob.sync(pattern, { ...options, cache: 'none' }).sort()
  const expected = referenceGlob(paths, pattern, options).sort()
  expect(actual).toEqual(expected)
  return actual
}

function doComparison({
  pattern,
  cwd,
  paths,
  expandDirectories,
}: {
  pattern: string
  cwd: string
  paths: string[]
  expandDirectories: boolean
}) {
  makeFiles(paths)
  both(paths, [pattern], { dot: false, types: 'files', cwd, expandDirectories })
}

function runTest(seed: number) {
  const source = new Source(seed)
  const paths = source.getRandomPaths()

  const pattern = source.getRandomPattern()
  const cwd = source.randomDirFromPaths(paths)

  const expandDirectories = source.random(2) === 0
  try {
    doComparison({ pattern, cwd, paths, expandDirectories })
  } catch (e) {
    console.error(
      'failed with seed ' + seed,
      JSON.stringify({ pattern, cwd, paths, expandDirectories }, null, 2),
    )
    throw e
  }
}

test(`lazyglob generative tests`, () => {
  for (let i = 0; i < 10000; i++) {
    const seed = Math.round(Math.random() * 4000000)
    vol.reset()
    runTest(seed)
  }
})

test(`regression`, () => {
  doComparison({
    pattern: '/lib',
    cwd: '/node_modules/src_lib',
    paths: [
      '/bulb-stove',
      '/lib_lib/src/node_modules-dist/stove-jeff.json',
      '/lib/banana.js',
      '/node_modules/src_lib/src-lib/banana-stove.js',
    ],
    expandDirectories: true,
  })
})

test(`regression 2`, () => {
  doComparison({
    pattern: '*',
    cwd: '/.src',
    paths: [
      '/src/stove-jeff',
      '/lib/banana.txt',
      '/lib-lib/src/bulb.txt',
      '/.src/src/jeff-stick',
      '/stick-bulb',
    ],
    expandDirectories: true,
  })
})

test('regression 3', () => {
  doComparison({
    pattern: '{**,*banana}',
    cwd: '/',
    paths: [
      '/lib_dist/dist/.lib_src/stove',
      '/lib-src/banana',
      '/dist-src/lib_src/src/stove-stove.js',
      '/jeff-stick.txt',
      '/src/stick-jeff.txt',
      '/dist-node_modules/node_modules/bulb.json',
    ],
    expandDirectories: true,
  })
})

test('regression 4', () => {
  doComparison({
    pattern: '/**/*/*/*',
    cwd: '/.src/node_modules',
    paths: [
      '/dist-src/banana-banana.txt',
      '/.src/node_modules/banana-stove',
      '/lib_lib/stick-jeff',
      '/src/src_src/banana-bulb',
      '/src_dist/src/node_modules/jeff',
      '/lib-node_modules/node_modules_node_modules/src/bulb.json',
      '/src-lib/node_modules_node_modules/stove',
    ],
    expandDirectories: true,
  })
})

test('regression 5', () => {
  doComparison({
    pattern: 'stick',
    cwd: '/',
    paths: [
      '/src_src/src-lib/lib/bulb-banana',
      '/stick',
      '/lib-lib/node_modules-node_modules/src/bulb',
      '/src-node_modules/dist_lib/dist-dist/banana-bulb.json',
      '/src-node_modules/node_modules_node_modules/bulb.json',
      '/node_modules_node_modules/node_modules-lib/node_modules/jeff',
      '/src/dist-dist/bulb-stick.js',
    ],
    expandDirectories: true,
  })
})

test('regression 6', () => {
  doComparison({
    pattern: '/*src',
    cwd: '/.src/node_modules-dist/node_modules_src',
    paths: ['/.src/dist/dist_lib/bulb.txt'],
    expandDirectories: true,
  })
})

test('regression 7', () => {
  doComparison({
    pattern: '**/{**,.dist*}',
    cwd: '/',
    paths: ['/.dist-src'],
    expandDirectories: true,
  })
})

test('regression 8', () => {
  doComparison({
    pattern: '**/{**,.dist*}',
    cwd: '/',
    paths: ['/lib/src/.dist-lib'],
    expandDirectories: true,
  })
})

test('regression 9', () => {
  doComparison({
    pattern: '/{dist*,**}',
    cwd: '/node_modules_node_modules/dist',
    paths: ['/src-node_modules/banana.ts'],
    expandDirectories: false,
  })
})

test('expandDirectories', () => {
  const paths = ['/src/stick.txt', '/src/banana/stick.txt', '/sugar.log', '/berthold']
  makeFiles(paths)
  const expanded = both(paths, ['s*'], {
    cwd: '/',
    expandDirectories: true,
    dot: false,
    types: 'files',
  }).sort()

  expect(expanded).toEqual(['/src/banana/stick.txt', '/src/stick.txt', '/sugar.log'])

  const notExpanded = both(paths, ['s*'], {
    cwd: '/',
    expandDirectories: false,
    dot: false,
    types: 'files',
  })

  expect(notExpanded).toEqual(['/sugar.log'])
})
