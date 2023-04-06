import fs from 'fs'

import kleur from 'kleur'
import { getManifestPath } from '../config'
import { log } from '../log'
import { compareManifests, renderChange } from '../manifest/compareManifests'
import { writeManifest } from '../manifest/writeManifest'
import { runCommand } from '../runCommand'

export async function runIfNeeded({ taskName, cwd }: { taskName: string; cwd: string }) {
	const currentManifestPath = getManifestPath({ taskName, cwd })
	const previousManifestPath = currentManifestPath + '.prev'

	log.log(`${kleur.bold(taskName)} 🎁 ${kleur.red(cwd)}`)

	const didHaveManifest = fs.existsSync(currentManifestPath)

	let prevManifest: Record<string, [hash: string, lastModified: number]> | undefined

	if (didHaveManifest) {
		fs.renameSync(currentManifestPath, previousManifestPath)
		const prevManifestString = fs.readFileSync(previousManifestPath, 'utf-8').toString()
		prevManifest = {}
		for (const line of prevManifestString.split('\n')) {
			const [thing, hash, lastModified] = line.split('\t')
			if (thing.startsWith('file ')) {
				const filePath = thing.slice('file '.length)
				prevManifest[filePath] = [hash, Number(lastModified)]
			}
		}
	}

	await writeManifest({ taskName, cwd, prevManifest })

	let didRunCommand = false

	if (didHaveManifest) {
		const diff = compareManifests({
			currentManifest: fs.readFileSync(currentManifestPath).toString(),
			previousManifest: fs.readFileSync(previousManifestPath).toString(),
		})

		if (diff.length) {
			log.log()
			diff.map(renderChange).forEach(log.substep)
			log.log()

			await runCommand({ taskName, cwd })
			didRunCommand = true
		}
	} else {
		await runCommand({ taskName, cwd })
		didRunCommand = true
	}

	if (!didRunCommand) {
		log.step(`Cache hit! 🎉\n`)
	}
}
