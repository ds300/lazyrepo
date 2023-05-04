import { fromZodError } from 'zod-validation-error'

/**
 * @param {import('zod').ZodError} error
 */
export function formatZodError(error) {
  return fromZodError(error, {
    issueSeparator: '\n',
    prefix: '',
    prefixSeparator: '',
  })
}
