import { beforeEach, describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'

interface MockResponsesClient {
  parse: (input: object) => Promise<object>
}

interface MockOpenAIClient {
  responses: MockResponsesClient
}

type MockParsedResponse = Pick<
  OpenAI.Responses.Response,
  'id' | 'output_text' | 'output' | 'error' | 'incomplete_details' | 'usage' | 'status'
> & {
  output_parsed: object | null
}

const { parseResponseMock } = vi.hoisted(() => {
  const localParseResponseMock = vi.fn<(input: object) => Promise<object>>()
  return {
    parseResponseMock: localParseResponseMock,
  }
})

vi.mock('openai', () => {
  class MockOpenAI implements MockOpenAIClient {
    responses: MockResponsesClient

    constructor(_config: object) {
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
  toneName: '像專業客服一樣禮貌',
  model: 'gpt-5-nano',
  openaiApiKey: 'openai-key',
  maxOutputTokens: 200,
}

const createMockParsedResponse = (overrides: Partial<MockParsedResponse> = {}): MockParsedResponse => ({
  id: 'resp_test_1',
  output_text: '',
  output: [],
  error: null,
  incomplete_details: null,
  usage: {
    total_tokens: 12,
  },
  output_parsed: {},
  status: 'completed',
  ...overrides,
})

describe('translation-parse-helper', () => {
  beforeEach(() => {
    parseResponseMock.mockReset()
  })

  it('parses source language and target translations with expected schema', async () => {
    parseResponseMock
      .mockResolvedValueOnce(
        createMockParsedResponse({
          id: 'resp_translate',
          output_parsed: {
            translations: [{ language: 'en', text: 'good morning' }],
          },
          usage: {
            total_tokens: 321,
          },
        })
      )

    const result = await translateText(TEST_INPUT)

    expect(result).toEqual({
      translations: [{ language: 'en', text: 'good morning' }],
      usageTotalTokens: 321,
    })

    expect(parseResponseMock).toHaveBeenCalledTimes(1)
    const firstCall = parseResponseMock.mock.calls[0]?.[0] as
      | OpenAI.Responses.ResponseCreateParamsNonStreaming
      | undefined
    if (!firstCall) {
      throw new Error('Expected parse call.')
    }
    expect(JSON.stringify(firstCall.text?.format?.schema)).toContain('"translations"')
    expect(JSON.stringify(firstCall.text?.format?.schema)).toContain('"language"')
    expect(JSON.stringify(firstCall.text?.format?.schema)).toContain('"text"')
    expect(firstCall.input).toContain('Target language codes (must use only these): zh-TW, en')
    expect(firstCall.input).toContain('Tone preference: 像專業客服一樣禮貌')
  })

  it('classifies response-level errors as response_error', async () => {
    parseResponseMock.mockResolvedValueOnce(
      createMockParsedResponse({
        output_parsed: null,
        error: {
          code: 'invalid_prompt',
          message: 'schema mismatch',
        },
      })
    )

    await expect(translateText(TEST_INPUT)).rejects.toThrow(
      '[translateText.output] OpenAI response error: invalid_prompt schema mismatch'
    )
  })
})
