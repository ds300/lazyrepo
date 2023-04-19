/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { join } from 'path'
import { findRootWorkspace } from '../src/project/findRootWorkspace.js'
import { loadWorkspace } from '../src/project/loadWorkspace.js'
import { Workspace } from '../src/project/project-types.js'
import type { Dir } from './integration/runIntegrationTests.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = global as any

g.__existentPaths = {}

afterEach(() => {
  g.__existentPaths = {}
})

function setPaths(pathTree: Dir) {
  g.__existentPaths = pathTree
}

function getIn(obj: any, path: string): string | null {
  while (path.startsWith('/')) path = path.slice(1)
  const parts = path.split('/')
  let current = obj
  while (parts.length && current) {
    current = current[parts.shift() ?? '']
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return current
}

jest.mock('../src/fs.js', () => {
  return {
    existsSync(path: string) {
      const g = global as any
      return !!getIn(g.__existentPaths, path)
    },
  }
})

jest.mock('../src/project/loadWorkspace.js', () => ({
  loadWorkspace: jest.fn((path: string) => {
    const g = global as any
    const stringified = getIn(g.__existentPaths, join(path, 'package.json'))
    return JSON.parse(stringified!)
  }),
}))

beforeEach(() => {
  ;(loadWorkspace as jest.Mock).mockClear()
})

describe('findRootWorkspace', () => {
  it('should return null if no package.json is found', () => {
    setPaths({
      a: { b: { c: {} } },
    })

    expect(findRootWorkspace('/a/b/c')).toBe(null)
  })

  const makeWorkspace = (
    dir: string,
    name: string,
    childWorkspaceGlobs: string[] = [],
  ): Workspace => ({
    name,
    allDependencyNames: [],
    childWorkspaceGlobs,
    childWorkspaceNames: [],
    // dir is replaced when loading
    dir,
    localDependencyWorkspaceNames: [],
    scripts: {},
  })

  it('should not return null if a package.json is found in the root', () => {
    const workspace = makeWorkspace('/', 'hello')
    setPaths({
      a: { b: { c: {} } },
      'package.json': JSON.stringify(workspace),
    })

    expect(findRootWorkspace('/a/b/c')).toEqual(workspace)
    expect(findRootWorkspace('/a/b/c')?.name).toEqual('hello')
  })

  it('should not return null if a package.json is found in the current dir', () => {
    const workspace = makeWorkspace('/a/b/c', 'sup')
    setPaths({
      a: {
        b: {
          c: {
            'package.json': JSON.stringify(workspace),
          },
        },
      },
    })

    expect(findRootWorkspace('/a/b/c')).toEqual(workspace)
    expect(findRootWorkspace('/a/b/c')?.name).toEqual('sup')
  })

  it('should not return null if a package.json is found in the parent dir', () => {
    const workspace = makeWorkspace('/a/b', 'yo')
    setPaths({
      a: {
        b: {
          'package.json': JSON.stringify(workspace),
          c: {},
        },
      },
    })

    expect(findRootWorkspace('/a/b/c')).toEqual(workspace)
    expect(findRootWorkspace('/a/b/c')?.name).toEqual('yo')
  })

  it('should return null if the package.json is in a child dir', () => {
    const workspace = makeWorkspace('/a/b/c', 'yo')
    setPaths({
      a: {
        b: {
          c: {
            'package.json': JSON.stringify(workspace),
          },
        },
      },
    })

    expect(findRootWorkspace('/a/b')).toEqual(null)
  })

  it('should return the root package.json if more than one is found and the root references the child', () => {
    const rootWorkspace = makeWorkspace('/a/b', 'yo', ['c'])
    const childWorkspace = makeWorkspace('/a/b/c', 'sup')
    setPaths({
      a: {
        b: {
          'package.json': JSON.stringify(rootWorkspace),
          c: {
            'package.json': JSON.stringify(childWorkspace),
          },
        },
      },
    })

    expect(findRootWorkspace('/a/b/c')).toEqual(rootWorkspace)
    expect(findRootWorkspace('/a/b/c')?.name).toEqual('yo')
  })

  it('should return the root package.json if theres a chain of three', () => {
    const rootWorkspace = makeWorkspace('/a', 'yo', ['b'])
    const childWorkspace = makeWorkspace('/a/b', 'hello', ['c'])
    const grandWorkspace = makeWorkspace('/a/b/c', 'sup')
    setPaths({
      a: {
        'package.json': JSON.stringify(rootWorkspace),
        b: {
          'package.json': JSON.stringify(childWorkspace),
          c: {
            'package.json': JSON.stringify(grandWorkspace),
          },
        },
      },
    })

    expect(findRootWorkspace('/a/b/c')).toEqual(rootWorkspace)
    expect(findRootWorkspace('/a/b/c')?.name).toEqual('yo')
  })

  it('should return the middle package.json if the root one does not reference the child', () => {
    const rootWorkspace = makeWorkspace('/a', 'yo', ['packages'])
    const childWorkspace = makeWorkspace('/a/b', 'hello', ['c'])
    const grandWorkspace = makeWorkspace('/a/b/c', 'sup')
    setPaths({
      a: {
        'package.json': JSON.stringify(rootWorkspace),
        b: {
          'package.json': JSON.stringify(childWorkspace),
          c: {
            'package.json': JSON.stringify(grandWorkspace),
          },
        },
      },
    })

    expect(findRootWorkspace('/a/b/c')).toEqual(childWorkspace)
    expect(findRootWorkspace('/a/b/c')?.name).toEqual('hello')
  })

  it('should skip the middle package.json if the middle one does not reference the grandchild but the root does', () => {
    const rootWorkspace = makeWorkspace('/a', 'yo', ['b/*'])
    const childWorkspace = makeWorkspace('/a/b', 'hello')
    const grandWorkspace = makeWorkspace('/a/b/c', 'sup')
    setPaths({
      a: {
        'package.json': JSON.stringify(rootWorkspace),
        b: {
          'package.json': JSON.stringify(childWorkspace),
          c: {
            'package.json': JSON.stringify(grandWorkspace),
          },
        },
      },
    })

    expect(findRootWorkspace('/a/b/c')).toEqual(rootWorkspace)
    expect(findRootWorkspace('/a/b/c')?.name).toEqual('yo')
    expect(findRootWorkspace('/a/b')).toEqual(childWorkspace)
    expect(findRootWorkspace('/a')).toEqual(rootWorkspace)
    expect(findRootWorkspace('/')).toEqual(null)
  })
})
