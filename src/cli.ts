import kleur from 'kleur'
import { help } from './commands/help'
import { runIfNeeded } from './commands/run-if-needed'
import { getStep } from './config'
import { log } from './log'
import { rainbow } from './rainbow'
import { getAllPackageDetails, topologicalSortPackages } from './workspace'

async function cli(args: string[]) {
	const [stepName] = args
	if (!stepName) {
		help(true)
		process.exit(1)
	}

	const step = getStep({ stepName })

	if (!step) {
		help(true)
		process.exit(1)
	}

	for (const dep of step.dependsOn ?? []) {
		await cli([dep])
	}

	if (stepName.startsWith('//#')) {
		await runIfNeeded({ stepName, cwd: './' })
	} else {
		const packages = getAllPackageDetails()
		const relevantPackages = Object.values(packages)
			.filter((pkg) => pkg.scripts?.[stepName])
			.map((pkg) => pkg.name)

		const sorted = topologicalSortPackages(packages)

		for (const p of sorted) {
			if (relevantPackages.includes(p.name)) {
				await runIfNeeded({ stepName, cwd: p.dir })
			}
		}
	}
}

async function main() {
	const done = log.timedTask(kleur.bold().bgGreen(' burborepo '))
	await cli(process.argv.slice(2))
	done(rainbow('>>> FULL BURBO'))
}

main()
