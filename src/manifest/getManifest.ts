import { statSync } from 'fs'
import { getTask } from '../config'
import { log } from '../log'
import { getInputFiles } from './getInputFiles'
import { hashFile, hashString } from './hash'

export async function getManifest({
	taskName,
	cwd,
	prevManifest,
}: {
	taskName: string
	cwd: string
	prevManifest?: Record<string, [hash: string, lastModified: number]>
}) {
	const result: string[] = []

	const step = await getTask({ taskName })

	for (const envVar of step.env ?? []) {
		result.push(`env ${envVar} \t${hashString(process.env[envVar] ?? '')}`)
	}

	let numSkipped = 0
	let numHashed = 0
	for (const file of await getInputFiles({ taskName, cwd })) {
		const prev = prevManifest?.[file]
		const stat = statSync(file)
		if (prev && prev[1] === stat.mtime.getTime()) {
			result.push(`file ${file}\t${prev[0]}\t${prev[1]}`)
			numSkipped++
			continue
		}

		numHashed++
		const hash = hashFile(file, stat.size)
		result.push(`file ${file}\t${hash}\t${stat.mtime.getTime()}`)
	}

	log.substep(`Hashed ${numHashed}/${numSkipped + numHashed} files`)

	result.sort()
	return result
}
