import fs from 'fs'
import path from 'path'
import { getManifestPath } from '../config'
import { log } from '../log'
import { getManifest } from './getManifest'

export async function writeManifest({
	taskName,
	cwd,
	prevManifest,
}: {
	taskName: string
	cwd: string
	prevManifest?: Record<string, [hash: string, lastModified: number]>
}) {
	const outputPath = getManifestPath({ taskName, cwd })
	if (!fs.existsSync(path.dirname(outputPath))) {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true })
	}
	const out = fs.createWriteStream(outputPath)

	for (const line of await getManifest({ taskName, cwd, prevManifest })) {
		out.write(line)
		out.write('\n')
	}

	return new Promise((resolve) => {
		out.on('close', resolve)
		log.substep(`Wrote manifest to ${outputPath}`)
		out.close()
	})
}
