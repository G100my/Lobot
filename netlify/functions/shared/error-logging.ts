export type ThrownError = Error | string | number | boolean | bigint | null | undefined | object

interface ErrorLogContext {
  [key: string]: string | number | boolean | null | undefined
}

interface ErrorLogDetails {
  errorName: string
  errorMessage: string
  errorStack?: string
  errorCause?: string
}

const stringifyObject = (value: object): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const resolveErrorCause = (error: Error): string | undefined => {
  const cause = error.cause
  if (cause === undefined || cause === null) {
    return undefined
  }

  if (cause instanceof Error) {
    return cause.message
  }

  return typeof cause === 'object' ? stringifyObject(cause) : String(cause)
}

const toErrorLogDetails = (error: ThrownError): ErrorLogDetails => {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      errorCause: resolveErrorCause(error),
    }
  }

  if (typeof error === 'string') {
    return {
      errorName: 'NonErrorThrown',
      errorMessage: error,
    }
  }

  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return {
      errorName: 'NonErrorThrown',
      errorMessage: String(error),
    }
  }

  if (error === null || error === undefined) {
    return {
      errorName: 'NonErrorThrown',
      errorMessage: String(error),
    }
  }

  return {
    errorName: 'NonErrorThrown',
    errorMessage: stringifyObject(error),
  }
}

export const logErrorWithContext = (
  message: string,
  context: ErrorLogContext,
  error: ThrownError,
  options: { includeStack?: boolean } = {}
): void => {
  const errorDetails = toErrorLogDetails(error)
  const payload =
    options.includeStack === false
      ? {
          ...context,
          errorName: errorDetails.errorName,
          errorMessage: errorDetails.errorMessage,
          errorCause: errorDetails.errorCause,
        }
      : {
          ...context,
          ...errorDetails,
        }

  console.error(message, payload)
}
