import { spawnSync } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import k from 'kleur'
import { getManifestPath } from './config'
import { log } from './log'

const { cyan, gray, green } = k

export async function runCommand({ stepName, cwd }: { stepName: string; cwd: string }) {
	const packageJson = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'))
	const command = packageJson.scripts[stepName.startsWith('//#') ? stepName.slice(3) : stepName]

	const extraArgs = process.argv.slice(3)

	log.step(green().bold(command))
	const start = Date.now()
	const result = spawnSync(command + ' ' + extraArgs.join(' '), {
		stdio: 'inherit',
		shell: true,
		cwd,
		env: {
			...process.env,
			PATH: `${process.env.PATH}:./node_modules/.bin:${process.cwd()}/node_modules/.bin`,
		},
	})
	if (result.status != 0) {
		const manifestPath = getManifestPath({ stepName, cwd })
		if (existsSync(manifestPath)) {
			unlinkSync(manifestPath)
		}
		log.fail(
			`Command '${command}' failed${
				result.status != null ? ` with exit code ${result.status}` : ''
			}`,
			{
				error: result.error,
			}
		)
	}
	log.log(gray(`\n              ∙  ∙  ∙\n`))
	log.step(`Done in ${cyan(((Date.now() - start) / 1000).toFixed(2) + 's')}`)
}
