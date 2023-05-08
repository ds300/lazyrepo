/* eslint-disable jest/expect-expect */
import assert from 'assert'
import { vol } from 'memfs'
import { minimatch } from 'minimatch'
import { dirname, isAbsolute, join } from 'path'
import { glob } from '../src/glob/glob.js'
import { Dir, File } from './integration/runIntegrationTests.js'
import { Random } from './test-utils.js'

jest.mock('../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

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

  getRandomPath(dir: boolean): string {
    const numSegments = this.random(4) + 1

    const segments = []
    for (let i = 0; i < numSegments - 1; i++) {
      segments.push(this.getRandomDirName())
    }
    if (!dir) {
      segments.push(this.getRandomFileName())
    }
    return '/' + segments.join('/')
  }

  getRandomTree(): Dir {
    const result: Dir = {}
    const numFiles = this.random(10)
    for (let i = 0; i < numFiles; i++) {
      const isDir = this.random(4) === 0
      const path = this.getRandomPath(isDir).split('/').filter(Boolean)
      let node: Exclude<Dir, string> = result
      for (const segment of path.slice(0, -1)) {
        if (typeof node[segment] !== 'object') {
          node[segment] = {}
        }
        node = node[segment] as Exclude<Dir, string>
      }
      node[path[path.length - 1]] = isDir ? {} : 'ok'
    }
    return result
  }

  getRandomPattern(): string {
    const absolute = this.random(4) === 0
    const negate = this.random(4) === 0

    const numParts = this.random(4) + 1

    const parts = []
    for (let i = 0; i < numParts; i++) {
      parts.push(this.getRandomPatternSegment())
    }
    let result = parts.join('/')
    if (absolute) {
      result = '/' + result
    }
    if (negate) {
      result = '!' + result
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

  randomPathFromDir(dir: Dir): string {
    const maxLength = this.random(4)
    let node = dir as File
    const path = []
    for (let i = 0; i < maxLength; i++) {
      if (!node || typeof node !== 'object') {
        break
      }
      const segment = this.useOneOf(Object.keys(node))
      if (segment) {
        path.push(segment)
        node = node[segment]
      } else {
        break
      }
    }

    return '/' + path.join('/')
  }
}

function extractDirs(dir: Dir) {
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

function extractFiles(dir: Dir) {
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

function referenceGlob(paths: string[] | Dir, patterns: string[], options: MatchOptions) {
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

const create = (path: string, file: File) => {
  if (typeof file === 'undefined') {
    // ignore
  } else if (typeof file === 'string') {
    // create file
    vol.writeFileSync(path, file)
  } else {
    // create dir
    vol.mkdirSync(path, { recursive: true })
    Object.entries(file).forEach(([fileName, file]) => {
      create(join(path, fileName), file)
    })
  }
}

function makeFiles(paths: string[] | Dir) {
  if (Array.isArray(paths)) {
    for (const path of paths) {
      const dir = dirname(path)
      vol.mkdirSync(dir, { recursive: true })
      vol.writeFileSync(path, 'ok')
      vol.statSync(dir)
      vol.statSync(path)
    }
  } else {
    create('/', paths)
  }
}

function both(paths: string[] | Dir, pattern: string[], options: MatchOptions) {
  const actual = glob.sync(pattern, { ...options, cache: 'none' }).sort()
  const expected = referenceGlob(paths, pattern, options).sort()
  expect(actual).toEqual(expected)
  return actual
}

function doComparison({
  patterns,
  cwd,
  paths,
  expandDirectories,
  dot,
  types,
}: {
  patterns: string[]
  cwd: string
  paths: string[] | Dir
  expandDirectories: boolean
  dot: boolean
  types: MatchTypes
}) {
  makeFiles(paths)
  return both(paths, patterns, { dot, types, cwd, expandDirectories })
}

function runTest(seed: number) {
  const source = new Source(seed)
  const paths = source.getRandomTree()

  const numPatterns = source.random(5) + 1
  const patterns = new Array(numPatterns).fill(0).map(() => source.getRandomPattern())
  const cwd = source.randomPathFromDir(paths)

  const expandDirectories = source.random(2) === 0
  const dot = source.random(2) === 0

  const types = source.useOneOf(['files', 'dirs', 'all'] as const)

  try {
    doComparison({ patterns, cwd, paths, expandDirectories, dot, types })
  } catch (e) {
    console.error(
      'failed with seed ' + seed,
      JSON.stringify({ patterns, cwd, paths, expandDirectories, dot, types }, null, 2),
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
    patterns: ['/lib'],
    cwd: '/node_modules/src_lib',
    paths: [
      '/bulb-stove',
      '/lib_lib/src/node_modules-dist/stove-jeff.json',
      '/lib/banana.js',
      '/node_modules/src_lib/src-lib/banana-stove.js',
    ],
    expandDirectories: true,
    dot: false,
    types: 'files',
  })
})

test(`regression 2`, () => {
  doComparison({
    patterns: ['*'],
    cwd: '/.src',
    paths: [
      '/src/stove-jeff',
      '/lib/banana.txt',
      '/lib-lib/src/bulb.txt',
      '/.src/src/jeff-stick',
      '/stick-bulb',
    ],
    expandDirectories: true,
    dot: false,
    types: 'files',
  })
})

test('regression 3', () => {
  doComparison({
    patterns: ['{**,*banana}'],
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
    dot: false,
    types: 'files',
  })
})

test('regression 4', () => {
  doComparison({
    patterns: ['/**/*/*/*'],
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
    dot: false,
    types: 'files',
  })
})

test('regression 5', () => {
  doComparison({
    patterns: ['stick'],
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
    dot: false,
    types: 'files',
  })
})

test('regression 6', () => {
  doComparison({
    patterns: ['/*src'],
    cwd: '/.src/node_modules-dist/node_modules_src',
    paths: ['/.src/dist/dist_lib/bulb.txt'],
    expandDirectories: true,
    dot: false,
    types: 'files',
  })
})

test('regression 7', () => {
  doComparison({
    patterns: ['**/{**,.dist*}'],
    cwd: '/',
    paths: ['/.dist-src'],
    expandDirectories: true,
    dot: false,
    types: 'files',
  })
})

test('regression 8', () => {
  doComparison({
    patterns: ['**/{**,.dist*}'],
    cwd: '/',
    paths: ['/lib/src/.dist-lib'],
    expandDirectories: true,
    dot: false,
    types: 'files',
  })
})

test('regression 9', () => {
  doComparison({
    patterns: ['/{dist*,**}'],
    cwd: '/node_modules_node_modules/dist',
    paths: ['/src-node_modules/banana.ts'],
    expandDirectories: false,
    dot: false,
    types: 'files',
  })
})

test('the "expandDirectories" option', () => {
  const paths = ['/src/stick.txt', '/src/banana/stick.txt', '/sugar.log', '/berthold']
  makeFiles(paths)
  const expanded = both(paths, ['s*'], {
    cwd: '/',
    expandDirectories: true,
    dot: false,
    types: 'files',
  })

  expect(expanded).toEqual(['/src/banana/stick.txt', '/src/stick.txt', '/sugar.log'])

  const notExpanded = both(paths, ['s*'], {
    cwd: '/',
    expandDirectories: false,
    dot: false,
    types: 'files',
  })

  expect(notExpanded).toEqual(['/sugar.log'])
})

describe('the "dot" option', () => {
  const paths = [
    '/src/stick.txt',
    '/src/.test/stick.txt',
    '/src/.ignore',
    '/.ignore',
    '/.lazy/manifest',
  ].sort()

  it('ignores dot files when false', () => {
    makeFiles(paths)
    const result = both(paths, ['**'], {
      cwd: '/',
      expandDirectories: false,
      dot: false,
      types: 'files',
    }).sort()

    expect(result).toEqual(['/src/stick.txt'])
  })

  it('ignores dot files in expanded directories', () => {
    makeFiles(paths)
    const result = both(paths, ['src'], {
      cwd: '/',
      expandDirectories: true,
      dot: false,
      types: 'files',
    }).sort()

    expect(result).toEqual(['/src/stick.txt'])
  })

  it('does not ignore dot files when true', () => {
    makeFiles(paths)
    const result = both(paths, ['**'], {
      cwd: '/',
      expandDirectories: false,
      dot: true,
      types: 'files',
    }).sort()

    expect(result).toEqual(paths)
  })

  it('does not ignore dot files when true in expanded dirs', () => {
    makeFiles(paths)
    const result = both(paths, ['src'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
    }).sort()

    expect(result).toEqual(['/src/.ignore', '/src/.test/stick.txt', '/src/stick.txt'])
  })
})

describe('the "types" option', () => {
  const dir: Dir = {
    src: {
      'banana.js': 'ok',
      'bubbles.js': 'ok',
      utils: {
        'index.js': 'ok',
      },
      '.test': {
        'index.test.js': 'ok',
      },
    },
    lib: {
      'index.js': 'ok',
    },
    'package.json': 'ok',
    '.gitignore': 'ok',
    '.lazy': {
      manifest: 'ok',
    },
  }
  beforeEach(() => {
    create('/', dir)
  })

  it('should return only files when "files" is passed', () => {
    const result = both(dir, ['**'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
    })

    expect(result).toEqual([
      '/.gitignore',
      '/.lazy/manifest',
      '/lib/index.js',
      '/package.json',
      '/src/.test/index.test.js',
      '/src/banana.js',
      '/src/bubbles.js',
      '/src/utils/index.js',
    ])
  })

  it('should return only dirs when "dirs" is passed', () => {
    const result = both(dir, ['**'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'dirs',
    })

    expect(result).toEqual(['/.lazy', '/lib', '/src', '/src/.test', '/src/utils'])
  })

  it('should return both files and dirs when "all" is passed', () => {
    const result = both(dir, ['**'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'all',
    })

    expect(result).toEqual([
      '/.gitignore',
      '/.lazy',
      '/.lazy/manifest',
      '/lib',
      '/lib/index.js',
      '/package.json',
      '/src',
      '/src/.test',
      '/src/.test/index.test.js',
      '/src/banana.js',
      '/src/bubbles.js',
      '/src/utils',
      '/src/utils/index.js',
    ])
  })
})

test('regression 10', () => {
  expect(
    doComparison({
      patterns: ['**'],
      cwd: '/lib',
      paths: {
        lib: {
          node_modules: {
            banana: 'ok',
          },
        },
      },
      expandDirectories: true,
      dot: false,
      types: 'dirs',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/lib/node_modules",
    ]
  `)
})

test('regression 11', () => {
  expect(
    doComparison({
      patterns: ['**'],
      cwd: '/lib',
      paths: {
        lib: {
          node_modules: {
            lib_dist: {
              stove: 'ok',
            },
          },
        },
      },
      expandDirectories: false,
      dot: true,
      types: 'all',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/lib/node_modules",
      "/lib/node_modules/lib_dist",
      "/lib/node_modules/lib_dist/stove",
    ]
  `)
})

describe('negation layers', () => {
  const dir: Dir = {
    src: {
      'banana.js': 'ok',
      'bubbles.js': 'ok',
      utils: {
        'index.js': 'ok',
      },
      '.test': {
        'index.test.js': 'ok',
      },
    },
    lib: {
      'index.js': 'ok',
    },
    'package.json': 'ok',
    '.gitignore': 'ok',
    '.lazy': {
      manifest: 'ok',
    },
  }
  beforeEach(() => {
    create('/', dir)
  })

  it('if the first pattern is a negation, it implies that all files are included to start', () => {
    const result = both(dir, ['!src'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
    })

    expect(result).toMatchInlineSnapshot(`
      [
        "/.gitignore",
        "/.lazy/manifest",
        "/lib/index.js",
        "/package.json",
      ]
    `)
  })

  it('allows things to be included after they have been excluded', () => {
    const result = both(dir, ['!src', 'src/utils'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'files',
    })

    expect(result).toMatchInlineSnapshot(`
      [
        "/.gitignore",
        "/.lazy/manifest",
        "/lib/index.js",
        "/package.json",
        "/src/utils/index.js",
      ]
    `)
  })

  it('allows multiple levels of inclusion and exclusion', () => {
    const result = both(dir, ['src', '!src/utils', '!.*', '.lazy'], {
      cwd: '/',
      expandDirectories: true,
      dot: true,
      types: 'all',
    })

    expect(result).toMatchInlineSnapshot(`
      [
        "/.lazy",
        "/.lazy/manifest",
        "/src",
        "/src/.test",
        "/src/.test/index.test.js",
        "/src/banana.js",
        "/src/bubbles.js",
      ]
    `)
  })
})

test('regression 12', () => {
  doComparison({
    patterns: ['**/steve', '/**'],
    cwd: '/',
    paths: {
      dist_lib: {
        jeff: 'ok',
      },
    },
    expandDirectories: false,
    dot: true,
    types: 'files',
  })
})

test('regression 13', () => {
  expect(
    doComparison({
      patterns: ['jeff', '!**'],
      cwd: '/',
      paths: {
        node_modules: {},
      },
      expandDirectories: false,
      dot: false,
      types: 'dirs',
    }),
  ).toMatchInlineSnapshot(`[]`)
})

test('regression 14', () => {
  expect(
    doComparison({
      patterns: ['/dist_dist', '**/chips'],
      cwd: '/dist_dist/src-dist',
      paths: {
        dist_dist: {
          'src-dist': {
            'stove-stick.txt': 'ok',
          },
        },
      },
      expandDirectories: true,
      dot: false,
      types: 'files',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/dist_dist/src-dist/stove-stick.txt",
    ]
  `)
})

test('regression 15', () => {
  expect(
    doComparison({
      patterns: ['!src*'],
      cwd: '/a',
      paths: {
        a: {
          src: {
            'jeff.md': 'ok',
          },
        },
      },
      expandDirectories: false,
      dot: true,
      types: 'files',
    }),
  ).toMatchInlineSnapshot(`[]`)
})

test('regression 16', () => {
  expect(
    doComparison({
      patterns: ['*/*', '*'],
      cwd: '/',
      paths: {
        src: {
          dist_dist: {
            node_modules: {
              'stove-stick.ts': 'ok',
            },
          },
        },
      },
      expandDirectories: false,
      dot: true,
      types: 'dirs',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/src",
      "/src/dist_dist",
    ]
  `)
})

test('regression 17', () => {
  expect(
    doComparison({
      patterns: ['lib/lib', 'node_modules*', 'node_modules*/jeff'],
      cwd: '/',
      paths: {
        'node_modules-lib': {},
      },
      expandDirectories: false,
      dot: false,
      types: 'dirs',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/node_modules-lib",
    ]
  `)
})

test('regression 18', () => {
  expect(
    doComparison({
      patterns: ['/dist', '{bulb,**}', '**/src_dist/**'],
      cwd: '/',
      paths: {
        'stick-stove.ts': 'ok',
        dist: {
          'jeff.txt': 'ok',
        },
      },
      expandDirectories: false,
      dot: false,
      types: 'files',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/dist/jeff.txt",
      "/stick-stove.ts",
    ]
  `)
})

test('regression 19', () => {
  expect(
    doComparison({
      patterns: ['!stove*/*stove', '!/*'],
      cwd: '/dist/.dist-src',
      paths: {
        dist: {
          '.dist-src': {
            'dist-src': {
              'stick-bulb': 'ok',
            },
          },
        },
      },
      expandDirectories: false,
      dot: false,
      types: 'all',
    }),
  ).toMatchInlineSnapshot(`[]`)
})

test('regression 20', () => {
  expect(
    doComparison({
      patterns: ['!/*src'],
      cwd: '/.src/dist',
      paths: {
        '.src': {
          dist: {
            'bulb.txt': 'ok',
          },
        },
      },
      expandDirectories: true,
      dot: false,
      types: 'all',
    }),
  ).toMatchInlineSnapshot(`[]`)
})

test('advanced syntax provided by micromatch works', () => {
  makeFiles({
    src: {
      dist: {
        'bulb.txt': 'ok',
      },
      lib: {
        'bulb.txt': 'ok',
      },
      '234': {
        'bulb.txt': 'ok',
      },
    },
  })
  expect(
    glob.sync(['src/!dist/*'], {
      cwd: '/',
    }),
  ).toMatchInlineSnapshot(`
    [
      "/src/234/bulb.txt",
      "/src/lib/bulb.txt",
    ]
  `)

  expect(glob.sync(['src/[[:digit:]][[:digit:]][[:digit:]]/*'], { cwd: '/' }))
    .toMatchInlineSnapshot(`
    [
      "/src/234/bulb.txt",
    ]
  `)
})
