import { beforeEach, describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import type { ParsedResponse as OpenAIParsedResponse } from 'openai/resources/responses/responses'

const { parseResponseMock } = vi.hoisted(() => ({
  parseResponseMock: vi.fn<(input: object) => Promise<object>>(),
}))

vi.mock('openai', () => {
  class MockOpenAI {
    responses: { parse: typeof parseResponseMock }

    constructor(_config: OpenAI.ClientOptions) {
      this.responses = {
        parse: parseResponseMock,
      }
    }
  }

  return {
    default: MockOpenAI,
  }
})

import { translateText } from '../netlify/functions/providers/ai/chatgpt/translation'

const TEST_INPUT: Parameters<typeof translateText>[0] = {
  text: '早安',
  languages: ['zh-TW', 'en'],
  model: 'gpt-5-nano',
  openaiApiKey: 'openai-key',
  maxOutputTokens: 200,
}

const createMockParsedResponse = <T>(overrides: Partial<OpenAIParsedResponse<T>>): OpenAIParsedResponse<T> => {
  return {
    id: 'resp_test_1',
    output_text: '',
    output: [],
    error: null,
    incomplete_details: null,
    usage: {
      total_tokens: 12,
    },
    output_parsed: null,
    status: 'completed',
    ...overrides,
  } as OpenAIParsedResponse<T>
}

describe('translation-output-contract', () => {
  beforeEach(() => {
    parseResponseMock.mockReset()
  })

  it('passes explicit target language list to the model input', async () => {
    parseResponseMock
      .mockResolvedValueOnce(
        createMockParsedResponse({
          id: 'resp_translate',
          output_parsed: {
            translations: [{ language: 'en', text: 'Good morning' }],
          },
          usage: {
            total_tokens: 39,
          },
        })
      )

    const result = await translateText(TEST_INPUT)

    expect(result.translations).toEqual([{ language: 'en', text: 'Good morning' }])
    expect(result.usageTotalTokens).toBe(39)

    const firstCall = parseResponseMock.mock.calls[0]?.[0] as OpenAI.Responses.ResponseCreateParamsNonStreaming | undefined
    expect(firstCall?.input).toContain('Target language codes (must use only these): zh-TW, en')
  })
})
