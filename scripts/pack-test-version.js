import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import pc from 'picocolors'
import { dedent } from 'ts-dedent'
import { exec } from './lib/exec.js'
import { getCurrentVersion } from './lib/getCurrentVersion.js'

const currentVersion = getCurrentVersion()
// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
const version = '0.0.0-test.' + Date.now()
exec(`npm version ${version} --no-git-tag-version`)
const bin = readFileSync('./bin.js')
const cli = readFileSync('./src/cli.js')
const types = readFileSync('./index.d.ts')

writeFileSync('./bin.js', `#!/usr/bin/env node\n import "${process.cwd()}/src/cli.js"`, {
  // make executable
  mode: 0o755,
})
writeFileSync('./src/cli.js', `import "${process.cwd()}/src/cli.js"`)
writeFileSync('./index.d.ts', `export * from "${process.cwd()}/src/config/config-types.js"`)

let outPath
try {
  outPath = exec(`npm pack`)
} finally {
  writeFileSync('./bin.js', bin, {
    // make executable
    mode: 0o755,
  })
  writeFileSync('./src/cli.js', cli)
  writeFileSync('./index.d.ts', types)
}

exec(`npm version ${currentVersion} --no-git-tag-version`)

const fullPath = join(process.cwd(), outPath)
// eslint-disable-next-line no-console
console.log(dedent`
  Wrote tarball:

    ${pc.cyan(pc.bold(fullPath))}

  To install:

    ${pc.cyan(pc.bold(`npm install lazyrepo@file:/${fullPath}`))}

`)
