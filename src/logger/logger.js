import { InteractiveLogger } from './InteractiveLogger.js'
import { RealtimeLogger } from './RealtimeLogger.js'

export const logger = process.stdout.isTTY
  ? new InteractiveLogger(process.stdout)
  : new RealtimeLogger(process.stdout, process.stderr)
