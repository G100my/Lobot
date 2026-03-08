import type { Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import handler from '../netlify/functions/line-webhook'

const TEST_CONTEXT = {} as Context

const DEFAULT_ENV = {
  LINE_CHANNEL_SECRET: 'test-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
  OPENAI_API_KEY: 'openai-key',
  OPENAI_MODEL: 'gpt-5-nano',
  OPENAI_MAX_OUTPUT_TOKENS: '200',
  OPENAI_DAILY_TOKEN_LIMIT: '5000',
} as const

const setEnvironment = (overrides: Partial<Record<keyof typeof DEFAULT_ENV, string | undefined>> = {}): void => {
  const nextEnv = { ...DEFAULT_ENV, ...overrides }

  ;(Object.keys(DEFAULT_ENV) as Array<keyof typeof DEFAULT_ENV>).forEach((key) => {
    const value = nextEnv[key]
    if (value === undefined) {
      delete process.env[key]
      return
    }

    process.env[key] = value
  })
}

const createLineSignature = (body: string, channelSecret: string): string =>
  createHmac('sha256', channelSecret).update(body).digest('base64')

const createRequest = (body: string, headers: Record<string, string | undefined>, method = 'POST'): Request => {
  const requestHeaders = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      requestHeaders.set(key, value)
    }
  }

  return new Request('http://localhost:8888/api/line/webhook', {
    method,
    headers: requestHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  })
}

describe('line-webhook-basic', () => {
  beforeEach(() => {
    setEnvironment()
  })

  it('returns 405 when method is not POST', async () => {
    const response = await handler(createRequest('', {}, 'GET'), TEST_CONTEXT)

    expect(response.status).toBe(405)
  })

  it('returns 500 when environment is missing', async () => {
    setEnvironment({
      LINE_CHANNEL_SECRET: undefined,
    })

    const body = JSON.stringify({ destination: 'U1', events: [] })
    const response = await handler(createRequest(body, {}), TEST_CONTEXT)

    expect(response.status).toBe(500)
  })

  it('returns 401 when signature is invalid', async () => {
    const body = JSON.stringify({ destination: 'U1', events: [] })
    const response = await handler(
      createRequest(body, {
        'x-line-signature': 'invalid-signature',
      }),
      TEST_CONTEXT
    )

    expect(response.status).toBe(401)
  })

  it('returns 400 when signature header is missing', async () => {
    const body = JSON.stringify({ destination: 'U1', events: [] })
    const response = await handler(createRequest(body, {}), TEST_CONTEXT)

    expect(response.status).toBe(400)
  })

  it('returns 400 for malformed webhook payload with valid signature', async () => {
    const malformedBody = '{this-is-not-valid-json'
    const signature = createLineSignature(malformedBody, DEFAULT_ENV.LINE_CHANNEL_SECRET)

    const response = await handler(
      createRequest(malformedBody, {
        'x-line-signature': signature,
      }),
      TEST_CONTEXT
    )

    expect(response.status).toBe(400)
  })

  it('returns 200 for valid signature and valid payload', async () => {
    const body = JSON.stringify({ destination: 'U1', events: [] })
    const signature = createLineSignature(body, DEFAULT_ENV.LINE_CHANNEL_SECRET)

    const response = await handler(
      createRequest(body, {
        'x-line-signature': signature,
      }),
      TEST_CONTEXT
    )

    expect(response.status).toBe(200)
  })
})
