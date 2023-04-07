import fs from 'fs'

import kleur from 'kleur'
import path from 'path'
import stripAnsi from 'strip-ansi'
import { getDiffPath, getManifestPath } from '../config'
import { log } from '../log'
import { compareManifests, renderChange } from '../manifest/compareManifests'
import { writeManifest } from '../manifest/writeManifest'
import { runCommand } from '../runCommand'

export async function runIfNeeded({
	taskName,
	cwd,
}: {
	taskName: string
	cwd: string
}): Promise<boolean> {
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
			const allLines = diff.map(renderChange)
			const diffPath = getDiffPath({ taskName, cwd })
			if (!fs.existsSync(path.dirname(diffPath))) {
				fs.mkdirSync(path.dirname(diffPath), { recursive: true })
			}
			fs.writeFileSync(diffPath, stripAnsi(allLines.join('\n')))
			log.substep('Cache miss, changes since last run:')
			allLines.slice(0, 10).forEach(log.substep)
			if (allLines.length > 10) {
				log.substep(`... and ${allLines.length - 10} more. See ${diffPath} for full diff.`)
			}

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

	return didRunCommand
}
