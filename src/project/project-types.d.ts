export interface PartialWorkspace {
  readonly name: string
  readonly dir: string
  readonly scripts: readonly { [scriptName: string]: string }
  readonly childWorkspaceGlobs: readonly string[]
  readonly allDependencyNames: readonly string[]
  readonly childWorkspaceNames?: readonly string[]
  readonly localDependencyWorkspaceNames?: readonly string[]
}

export type Workspace = Required<PartialWorkspace>

export type PackageManger = 'npm' | 'yarn' | 'pnpm'
