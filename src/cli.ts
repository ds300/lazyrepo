import kleur from 'kleur'
import { help } from './commands/help'
import { runIfNeeded } from './commands/run-if-needed'
import { getTask } from './config'
import { log } from './log'
import { rainbow } from './rainbow'
import { getRepoDetails } from './workspace'

async function cli(args: string[]) {
	const [taskName] = args
	if (!taskName) {
		help(true)
		process.exit(1)
	}

	const task = await getTask({ taskName })

	if (!task) {
		help(true)
		process.exit(1)
	}

	for (const dep of Object.keys(task.dependsOn ?? {})) {
		await cli([dep])
	}

	if (taskName.startsWith('//#')) {
		await runIfNeeded({ taskName, cwd: './' })
	} else {
		const { packagesInTopologicalOrder } = getRepoDetails()
		const relevantPackages = packagesInTopologicalOrder.filter((pkg) => pkg.scripts?.[taskName])

		for (const p of relevantPackages) {
			await runIfNeeded({ taskName, cwd: p.dir })
		}
	}
}

async function main() {
	const done = log.timedTask(kleur.bold().bgGreen(' daddyrepo '))
	await cli(process.argv.slice(2))
	done(rainbow('>>> FULL DADDY'))
}

main()
