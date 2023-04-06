import { spawnSync } from 'child_process'
import { log } from './log'

export function exec(...args: Parameters<typeof spawnSync>) {
	const result = spawnSync(...args)
	if (result.status !== 0) {
		log.fail(`ERROR: Shell command failed: ${[args[0]].concat(args[1] ?? []).join(' ')}`, {
			detail: result.stderr?.toString(),
			error: result.error,
		})
	}
	return result.stdout.toString()
}
