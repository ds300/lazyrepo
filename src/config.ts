import slugify from '@sindresorhus/slugify'
import fs from 'fs'
import path from 'path'
import { log } from './log'

export type GlobConfig = string[] | { include?: string[]; exclude?: string[] }

export type CacheConfig =
	| 'none'
	| {
			/**
			 * Globs of files that this task depends on.
			 *
			 * If none are specified, all files in the package will be used.
			 */
			inputs?: GlobConfig
			/**
			 * Globs of files that this task produces.
			 *
			 * If none are specified, none will be tracked.
			 */
			outputs?: GlobConfig
			/**
			 * Any environment variables that this task uses
			 */
			env?: string[]
			/**
			 * If this task is not independent, this controls whether or not the output created by
			 * upstream packages running this task counts towards the input for the current package.
			 *
			 * @default true
			 */
			usesOutputFromDependencies?: boolean
			/**
			 * If this task is not independent, this controls whether or not the inputs used by
			 * upstream packages running this task counts towards the input for the current package.
			 *
			 * @default true
			 */
			usesInputFromDependencies?: boolean
	  }

export interface Task {
	/**
	 * Run the task in the root directory only.
	 *
	 * @default false
	 */
	topLevel?: boolean
	/** The other commands that must be completed before this one can run. */
	dependsOn?: {
		[taskName: string]: {
			/**
			 * Whether or not this task uses the files created by the named task.
			 * If true, they will be included as cache inputs.
			 *
			 * @default true
			 */
			usesOutput?: boolean
			/**
			 * Whether or not the input files of the named task should contribute to the
			 * cache inputs of this task.
			 *
			 * @default false
			 */
			inheritsInput?: boolean
		}
	}

	/**
	 * The configuration for the input + output caches.
	 *
	 * Set to `none` to disable caching. This means the task will always run fully when invoked.
	 *
	 * @default { inputs: ["**\/*"] }
	 */
	cache?: CacheConfig

	/**
	 * Whether or not the task must be executed in dependency order.
	 *
	 * If true, the ordering does not matter.
	 * If false, the task will be executed based on topological dependency order.
	 *
	 * @default false
	 */
	independent?: boolean

	/**
	 * Whether this task can be safely executed in parallel with other instances of the same task.
	 *
	 * @default true
	 */
	parallel?: boolean
}

export interface LazyConfig {
	/** Globs of any files that should contribute to the cache key for all steps. */
	globalDependencies?: string[]
	/** Globs of any files that should _never_ contribute to the cache key for all steps. These cannot be overridden. */
	globalExcludes?: string[]
	tasks?: { [taskName: string]: Task }
}

let _config: LazyConfig | null = null

export async function getConfig(): Promise<LazyConfig> {
	if (_config) {
		return _config
	}

	const file = path.join(process.cwd(), 'lazy.config.ts')
	if (!fs.existsSync(file)) {
		log.fail(`Can't find config file at '${file}'`, {
			error: new Error('stack'),
		})
	}

	const config = (await import(file)).default as LazyConfig

	_config = config

	return config
}

export async function getTask({ taskName }: { taskName: string }) {
	return (await getConfig()).tasks?.[taskName] ?? {}
}

export function getManifestPath({ taskName, cwd }: { taskName: string; cwd: string }) {
	const dir = path.join(cwd, 'node_modules', '.cache', 'lazy', 'manifests')
	return path.join(dir, slugify(taskName))
}
