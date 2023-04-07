import glob from 'fast-glob'
import fs from 'fs'
import path from 'path'
import { getTask, GlobConfig } from '../config'
import { log } from '../log'

function getIncludes(includes: string[] | undefined): string[] {
	if (!includes) {
		return ['**/*']
	}
	if (typeof includes === 'string') {
		return [includes]
	}
	return includes
}

function getExcludes(excludes: string[] | undefined): string[] {
	if (!excludes) {
		return []
	}
	if (typeof excludes === 'string') {
		return [excludes]
	}
	return excludes
}

function extractGlobPattern(glob: GlobConfig | null | undefined) {
	if (!glob) {
		return {
			include: ['**/*'],
			exclude: [],
		}
	}
	if (Array.isArray(glob)) {
		return {
			include: glob,
			exclude: [],
		}
	}

	return glob
}

export async function getInputFiles({ taskName, cwd }: { taskName: string; cwd: string }) {
	const { cache } = (await getTask({ taskName })) ?? {}

	if (cache === 'none') {
		return null
	}

	const files = new Set<string>()

	const { include, exclude } = extractGlobPattern(cache?.inputs)

	const includes = getIncludes(include)
	const excludes = getExcludes(exclude)

	for (const pattern of includes) {
		await log.timedStep('Finding inputs ' + pattern, () => {
			for (const file of glob.sync(pattern, {
				cwd,
				ignore: ['node_modules', '.git', '.lazy', ...excludes],
				dot: true,
			})) {
				const fullPath = path.join(cwd, file)
				if (fs.statSync(fullPath).isDirectory()) {
					visitAllFiles(fullPath, (filePath) => files.add(filePath))
				} else {
					files.add(fullPath)
				}
			}
		})
	}

	return [...files].sort()
}

function visitAllFiles(dir: string, visit: (filePath: string) => void) {
	for (const fileName of fs.readdirSync(dir)) {
		const fullPath = path.join(dir, fileName)
		if (fs.statSync(fullPath).isDirectory()) {
			visitAllFiles(fullPath, visit)
		} else {
			visit(fullPath)
		}
	}
}
