import { spawnSync } from 'child_process'
import { getTask } from '../config.js'
import { logger } from '../logger/logger.js'

export async function inherit() {
  const scriptName = process.env.npm_lifecycle_event
  if (!scriptName) {
    logger.fail(
      'No npm_lifecycle_event found. Did you run `lazy :inherit` directly instead of via "scripts"?',
    )
    process.exit(1)
  }
  const task = await getTask({ taskName: scriptName })
  if (!task.baseCommand) {
    logger.fail(
      `No baseCommand found for task '${scriptName}'. Using :inherit requires you to add one in your lazy.config file!`,
    )
    process.exit(1)
  }
  const result = spawnSync(task.baseCommand, process.argv.slice(3), {
    stdio: 'inherit',
    shell: true,
  })
  if (result.status === null) {
    logger.fail(`Failed to run '${task.baseCommand}'`, { error: result.error })
    process.exit(1)
  }
  process.exit(result.status)
}
