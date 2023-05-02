import { basename, join } from 'path'
import { LazyConfig } from '../index.js'
import { Config } from '../src/config/config.js'
import { Project } from '../src/project/Project.js'
import { Workspace } from '../src/project/project-types.js'

const cwd = process.cwd()

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
