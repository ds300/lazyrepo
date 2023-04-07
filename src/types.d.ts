export type TaskStatus = 'pending' | 'running' | 'success:eager' | 'success:lazy' | 'failure'

export interface ScheduledTask {
  taskName: string
  cwd: string
  status: TaskStatus
  outputFiles: string[]
  dependencies: string[]
}

export type PackageDetails = {
  name: string
  dir: string
  localDeps: string[]
  version: string
  scripts: Record<string, string>
}

export type RepoDetails = {
  packagesByName: Record<string, PackageDetails>
  packagesInTopologicalOrder: PackageDetails[]
}

export * from '../index.js'

export type ManifestChange = {
  type: 'addition' | 'removal' | 'modification'
  value: string
}
