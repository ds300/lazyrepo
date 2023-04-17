import { spawnSync } from 'child_process'
import { Config } from '../config.js'
import { logger } from '../logger/logger.js'

export async function inherit() {
  const scriptName = process.env.npm_lifecycle_event
  if (!scriptName) {
    logger.fail(
      'No npm_lifecycle_event found. Did you run `lazy inherit` directly instead of via "scripts"?',
    )
    process.exit(1)
  }
  const config = await Config.from(process.cwd())
  const task = config.getTaskConfig(process.cwd(), scriptName)
  if (!task._config.baseCommand) {
    logger.fail(
      `No baseCommand found for task '${scriptName}'. Using 'lazy inherit' requires you to add a baseCommand for the relevant task in your lazy.config file!`,
    )
    process.exit(1)
  }
  const result = spawnSync(task._config.baseCommand, process.argv.slice(3), {
    stdio: 'inherit',
    shell: true,
  })
  if (result.status === null) {
    logger.fail(`Failed to run '${task._config.baseCommand}'`, { error: result.error })
    process.exit(1)
  }
  process.exit(result.status)
}
