import slugify from '@sindresorhus/slugify'
import stableStringify from 'fast-json-stable-stringify'
import fs from 'fs'
import path from 'path'
import { log } from './log'
import { hashString } from './manifest/hash'

import k from 'kleur'
const { gray } = k

export interface Task {
	/** The other commands that must be completed before this one can run. */
	dependsOn?: string[]
	/** Globs of files that this task depends on. */
	inputs?: string[]
	/** Globs of files that this task produces. */
	outputs?: []
	/** Any environment variables that this task uses */
	env?: string[]
}

export interface Config {
	/** Globs of any files that should contribute to the cache key for all steps. */
	globalDependencies?: string[]
	/** Optionally extend the root config. */
	extends?: ['//']
	pipeline: { [taskName: string]: Task }
}

let _config: Config | null = null

export function getConfig(): Config {
	if (_config) {
		return _config
	}
	const file = './turbo.json'
	if (!fs.existsSync(file)) {
		log.fail(`Can't find config file at '${file}'`, {
			error: new Error('stack'),
		})
	}

	const config = JSON.parse(fs.readFileSync(file, 'utf8'))

	_config = config

	return config
}

export function getStep({ stepName }: { stepName: string }) {
	return getConfig().pipeline[stepName] ?? log.fail(`No step called '${stepName}'`)
}

export function getStepKey({ stepName }: { stepName: string }) {
	const step = getStep({ stepName })
	const slug = slugify(stepName)
	const stepHash = hashString(stableStringify(step))
	return [slug, stepHash].join('-')
}

export function getManifestPath({ stepName, cwd }: { stepName: string; cwd: string }) {
	const dir = path.join(cwd, 'node_modules', '.cache', 'burbo', 'manifests')
	return path.join(dir, slugify(stepName))
}

export const renderStepName = ({ stepName }: { stepName: string }) =>
	`${gray("'")}${stepName}${gray("'")}`
