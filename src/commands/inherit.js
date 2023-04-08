import { spawnSync } from 'child_process'
import { getTask } from '../config.js'
import { log } from '../log.js'

export async function inherit() {
  const scriptName = process.env.npm_lifecycle_event
  if (!scriptName) {
    log.fail(
      'No npm_lifecycle_event found. Did you run `lazy :inherit` directly instead of via "scripts"?',
    )
    process.exit(1)
  }
  const task = await getTask({ taskName: scriptName })
  if (!task.defaultCommand) {
    log.fail(
      `No defaultCommand found for task '${scriptName}'. Using :inherit requires you to add one in your lazy.config file!`,
    )
    process.exit(1)
  }
  const result = spawnSync(task.defaultCommand, process.argv.slice(3), {
    stdio: 'inherit',
    shell: true,
  })
  if (result.status === null) {
    log.fail(`Failed to run '${task.defaultCommand}'`, { error: result.error })
    process.exit(1)
  }
  process.exit(result.status)
}
