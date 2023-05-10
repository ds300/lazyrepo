import { LazyConfig } from '../index.js'
import { Config } from '../src/config/config.js'
import { cwd } from '../src/cwd.js'
import { basename, join } from '../src/path.js'
import { Project } from '../src/project/Project.js'
import { Workspace } from '../src/project/project-types.js'

export function makeScripts(names: string[], command = 'echo whatever'): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, command]))
}

export function makeWorkspace(name: string, w: Partial<Omit<Workspace, 'name'>> = {}): Workspace {
  return {
    dir: w.dir ?? join(cwd, `packages/${basename(name)}`),
    name,
    scripts: w.scripts ?? {},
    allDependencyNames: w.allDependencyNames ?? w.localDependencyWorkspaceNames ?? [],
    childWorkspaceGlobs: w.childWorkspaceGlobs ?? [],
    childWorkspaceNames: w.childWorkspaceNames ?? [],
    localDependencyWorkspaceNames: w.localDependencyWorkspaceNames ?? [],
  }
}

export function makeProject(workspaces: Workspace[], rootWorkspace?: Workspace): Project {
  const workspacesByName: Record<string, Workspace> = Object.fromEntries(
    workspaces
      .concat([
        rootWorkspace ??
          ({
            dir: cwd,
            name: 'root',
            scripts: {},
            allDependencyNames: [],
            childWorkspaceGlobs: [],
            childWorkspaceNames: [],
            localDependencyWorkspaceNames: [],
          } satisfies Workspace),
      ])
      .map((pkg) => [pkg.name, pkg]),
  )
  return new Project(
    {
      rootWorkspaceName: 'root',
      workspacesByName,
    },
    'npm',
  )
}

export function createProject(): Project {
  const workspaces: Workspace[] = [
    makeWorkspace('core', {
      localDependencyWorkspaceNames: ['utils'],
      scripts: makeScripts(['prepack', 'pack', 'core-build']),
    }),
    makeWorkspace('utils', { scripts: makeScripts(['prepack', 'pack', 'utils-build']) }),
  ]
  return makeProject(workspaces)
}

export function makeConfig(project: Project, scripts: LazyConfig['scripts']): Config {
  return new Config({
    project,
    rootConfig: {
      config: {
        scripts,
      },
      filePath: null,
    },
    isVerbose: false,
  })
}

export function createConfig(scripts: LazyConfig['scripts']): Config {
  return makeConfig(createProject(), scripts)
}

export class Random {
  constructor(private _seed: number) {}

  random(n: number = Number.MAX_SAFE_INTEGER) {
    this._seed = (this._seed * 9301 + 49297) % 233280
    // float is a number between 0 and 1
    const float = this._seed / 233280
    return Math.floor(float * n)
  }

  execOneOf<Result>(choices: Array<(() => any) | { weight: number; do: () => any }>): Result {
    type Choice = (typeof choices)[number]
    const getWeightFromChoice = (choice: Choice) => ('weight' in choice ? choice.weight : 1)
    const totalWeight = Object.values(choices).reduce(
      (total, choice) => total + getWeightFromChoice(choice),
      0,
    )
    const randomWeight = this.random(totalWeight)
    let weight = 0
    for (const choice of Object.values(choices)) {
      weight += getWeightFromChoice(choice)
      if (randomWeight < weight) {
        return 'do' in choice ? choice.do() : choice()
      }
    }
    throw new Error('unreachable')
  }

  useOneOf<Elem>(items: readonly Elem[]): Elem {
    return items[this.random(items.length)]
  }
}
