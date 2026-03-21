import { execSync } from 'child_process'

export const exec = (/** @type {string} */ cmd) => {
  try {
    console.log('running command: ' + cmd)
    const output = execSync(cmd).toString().trim()
    console.log('output: ' + output)
    return output
  } catch (/** @type {any} */ e) {
    console.error(e.stderr?.toString())
    process.exit(1)
  }
}
