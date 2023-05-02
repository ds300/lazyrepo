import { execCli } from './execCli.js'

// eslint-disable-next-line n/no-process-exit
process.exit(await execCli(process.argv))
