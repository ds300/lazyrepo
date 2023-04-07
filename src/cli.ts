import kleur from 'kleur'
import { TaskGraph } from './TaskGraph'
import { help } from './commands/help'
import { getConfig, getTask } from './config'
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

	const tasks = new TaskGraph({
		config: await getConfig(),
		endTasks: [taskName],
		repoDetails: getRepoDetails(),
	})

	while (await tasks.startNextTask()) {}
}

async function main() {
	const done = log.timedTask(kleur.bold().bgGreen(' lazyrepo '))
	await cli(process.argv.slice(2))
	done(rainbow('>>> FULL LAZY 🐢'))
}

main()
