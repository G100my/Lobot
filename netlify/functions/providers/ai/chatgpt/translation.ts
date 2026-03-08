import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { ParsedResponse as OpenAIParsedResponse } from 'openai/resources/responses/responses'
import { z } from 'zod'
import { TRANSLATION_SINGLE_PASS_INSTRUCTIONS } from '../../../line-webhook/constants'
import type { AiProviderErrorKind } from '../../../line-webhook/types'
import { logErrorWithContext, type ThrownError } from '../../../shared/error-logging'
import { classifyOutputIssue, getResponseSummary, getUsageTotalTokens } from './response-helpers'

type TranslateTextStage = 'request' | 'parse' | 'output' | 'usage'

interface TranslateTextInput {
  text: string
  languages: string[]
  toneName?: string
  model: string
  openaiApiKey: string
  maxOutputTokens: number
}

interface TranslationResultItem {
  language: string
  text: string
}

interface TranslationData {
  translations: TranslationResultItem[]
  usageTotalTokens: number
}

type ParsedTranslationOutput = z.infer<ReturnType<typeof buildTranslationSchema>>

const buildTranslationSchema = () =>
  z.object({
    translations: z
      .array(
        z.object({
          language: z.string().trim().min(1),
          text: z.string().trim().min(1),
        })
      )
      .min(1),
  })

const buildToneInstruction = (toneName: string | undefined): string =>
  toneName === undefined ? 'Tone preference: neutral and natural.' : `Tone preference: ${toneName}.`

export class TranslateTextStageError extends Error {
  stage: TranslateTextStage
  kind: AiProviderErrorKind
  response?: OpenAI.Responses.Response

  constructor(
    stage: TranslateTextStage,
    kind: AiProviderErrorKind,
    detail: string,
    response?: OpenAI.Responses.Response,
    cause?: ThrownError
  ) {
    if (cause === undefined) {
      super(`[translateText.${stage}] ${detail}`)
    } else {
      super(`[translateText.${stage}] ${detail}`, { cause })
    }
    this.name = 'TranslateTextStageError'
    this.stage = stage
    this.kind = kind
    this.response = response
  }
}

const throwStageError = (
  input: TranslateTextInput,
  stage: TranslateTextStage,
  kind: AiProviderErrorKind,
  detail: string,
  response?: OpenAI.Responses.Response,
  cause?: ThrownError
): never => {
  const error = new TranslateTextStageError(stage, kind, detail, response, cause)
  logErrorWithContext(
    '[line-webhook] translateText failed.',
    {
      stage,
      kind,
      model: input.model,
      languageCount: input.languages.length,
      hasTone: input.toneName !== undefined,
      ...(response === undefined ? {} : getResponseSummary(response)),
    },
    error
  )
  throw error
}

const readParsedOutput = <T>(response: OpenAIParsedResponse<T>, input: TranslateTextInput): T => {
  if (response.output_parsed !== null) return response.output_parsed
  const issue = classifyOutputIssue(response, 'OpenAI translation response is empty.')
  return throwStageError(input, 'output', issue.kind, issue.detail, response)
}

const readUsageTokens = (response: OpenAI.Responses.Response, input: TranslateTextInput): number => {
  const usageTotalTokens = getUsageTotalTokens(response)
  if (usageTotalTokens === null) {
    return throwStageError(input, 'usage', 'usage_error', 'usage.total_tokens is missing or invalid.', response)
  }
  return usageTotalTokens
}

const requestParsedResponse = async <T>(
  openai: OpenAI,
  input: TranslateTextInput,
  requestName: string,
  instructions: string,
  requestInput: string,
  schema: z.ZodType<T>
): Promise<OpenAIParsedResponse<T>> => {
  try {
    return await openai.responses.parse({
      model: input.model,
      max_output_tokens: input.maxOutputTokens,
      reasoning: { effort: 'minimal' },
      instructions,
      input: requestInput,
      text: {
        format: zodTextFormat(schema, requestName),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return throwStageError(
        input,
        'parse',
        'schema_parse_error',
        'OpenAI translation response is not valid JSON schema.',
        undefined,
        error as ThrownError
      )
    }

    return throwStageError(
      input,
      'request',
      'request_error',
      'Failed to call OpenAI Responses API.',
      undefined,
      error as ThrownError
    )
  }
}

export const translateText = async (input: TranslateTextInput): Promise<TranslationData> => {
  const openai = new OpenAI({ apiKey: input.openaiApiKey })

  const response = await requestParsedResponse<ParsedTranslationOutput>(
    openai,
    input,
    'translation_result',
    TRANSLATION_SINGLE_PASS_INSTRUCTIONS,
    `Target language codes (must use only these): ${input.languages.join(', ')}\n${buildToneInstruction(input.toneName)}\nText to translate:\n${input.text}`,
    buildTranslationSchema()
  )
  const parsedOutput = readParsedOutput(response, input)
  const usageTotalTokens = readUsageTokens(response, input)

  return {
    translations: parsedOutput.translations,
    usageTotalTokens,
  }
}
