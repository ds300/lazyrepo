import type { TaskConfig } from './config/config.js'
import { Workspace } from './project/project-types.js'

export type TaskStatus = 'pending' | 'running' | 'success:eager' | 'success:lazy' | 'failure'

export interface ScheduledTask {
  key: string
  taskConfig: TaskConfig
  scriptName: string
  status: TaskStatus
  force: boolean
  extraArgs: string[]
  outputFiles: string[] | null
  dependencies: string[]
  inputManifestCacheKey: string | null
  workspace: Workspace
  logger: TaskLogger
}

export type ManifestChange = {
  type: 'addition' | 'removal' | 'modification'
  value: string
}

export type RequestedTask = {
  scriptName: string
  filterPaths: string[]
  extraArgs: string[]
  force: boolean
}

export type CLIOption = {
  force: boolean
  filter?: string | string[]
  verbose: boolean
  '--': string[]
}

export interface Logger {
  isVerbose: boolean

  log(...message: string[]): void
  group(title: string, content: string): void
  info(...message: string[]): void
  note(...message: string[]): void
  warn(...message: string[]): void
  success(...message: string[]): void
  fail(headline: string, more?: { error?: Error; detail?: string }): void
}

export interface PackageJson {
  name: string
  version: string
  dependencies?: { [depName: string]: string }
  devDependencies?: { [depName: string]: string }
  peerDependencies?: { [depName: string]: string }
  optionalDependencies?: { [depName: string]: string }
  scripts?: { [scriptName: string]: string }
  workspaces?: string[]
  type?: 'module' | 'commonjs'
}

export interface TaskLogger extends Logger {
  restartTimer(): void
  diff(diffLine: string): void
}

export interface CliLogger extends Logger {
  task(scriptName: string, isVerbose: boolean): TaskLogger
}
