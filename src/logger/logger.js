import { InteractiveLogger } from './InteractiveLogger.js'
import { RealtimeLogger } from './RealtimeLogger.js'

export const logger =
  process.env.LAZYREPO_PRETTY_OUTPUT === 'true' &&
  process.stdout.isTTY &&
  !process.env.JEST_WORKER_ID
    ? new InteractiveLogger(process.stdout)
    : new RealtimeLogger(process.stdout)
