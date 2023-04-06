import glob from 'fast-glob'
import fs from 'fs'
import path from 'path'
import { getStep } from '../config'
import { log } from '../log'

export async function getInputFiles({ stepName, cwd }: { stepName: string; cwd: string }) {
	const { inputs } = getStep({ stepName })
	const files = new Set<string>()

	for (const globPattern of inputs ?? []) {
		await log.timedStep('Globbing files ' + globPattern, () => {
			for (const file of glob.sync(globPattern, { cwd, ignore: ['**/node_modules/**'] })) {
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
