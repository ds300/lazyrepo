import { spawn } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import k from 'kleur'
import { getManifestPath } from './config'
import { log } from './log'

const { cyan, gray, green } = k

export async function runCommand({ taskName, cwd }: { taskName: string; cwd: string }) {
  const packageJson = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'))
  const command = packageJson.scripts[taskName.startsWith('//#') ? taskName.slice(3) : taskName]

  const extraArgs = process.argv.slice(3)

  log.step(green().bold(command))
  const start = Date.now()
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(command + ' ' + extraArgs.join(' '), {
        stdio: 'inherit',
        shell: true,
        cwd,
        env: {
          ...process.env,
          PATH: `${process.env.PATH}:./node_modules/.bin:${process.cwd()}/node_modules/.bin`,
        },
      })
      proc.on('error', reject)
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(null)
        } else {
          reject(new Error(`Command '${command}' exited with code ${code}`))
        }
      })
    })
  } catch (e) {
    const manifestPath = getManifestPath({ taskName, cwd })
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath)
    }
    throw e
  }

  log.log(gray(`\n              ∙  ∙  ∙\n`))
  log.step(`Done in ${cyan(((Date.now() - start) / 1000).toFixed(2) + 's')}`)
}
