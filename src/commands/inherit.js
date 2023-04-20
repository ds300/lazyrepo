import { spawnSync } from 'child_process'
import { relative } from 'path'
import pc from 'picocolors'
import { Config } from '../config/config.js'
import { logger } from '../logger/logger.js'

export async function inherit() {
  const scriptName = process.env.npm_lifecycle_event
  if (!scriptName) {
    logger.fail(
      'No npm_lifecycle_event found. Did you run `lazy inherit` directly instead of via "scripts"?',
    )
    process.exit(1)
  }
  const config = await Config.fromCwd(process.cwd())
  const workspace = config.project.getWorkspaceByDir(process.cwd())
  const task = config.getTaskConfig(workspace, scriptName)
  if (!task.baseCommand) {
    logger.fail(
      `No baseCommand found for task '${scriptName}'. Using 'lazy inherit' requires you to add a baseCommand for the relevant task in your lazy.config file!`,
    )
    process.exit(1)
  }

  const command = task.command
  logger.log(
    pc.bold('RUN ') +
      pc.green(pc.bold(command)) +
      pc.gray(' in ' + relative(process.cwd(), task.workspace.dir) ?? './'),
  )

  const result = spawnSync(command, process.argv.slice(3), {
    stdio: 'inherit',
    shell: true,
  })
  if (result.status === null) {
    logger.fail(`Failed to run '${command}'`, { error: result.error })
    process.exit(1)
  }
  process.exit(result.status)
}
