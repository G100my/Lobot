import type OpenAI from 'openai'
import type { AiProviderErrorKind } from '../../../line-webhook/types'

const hasRefusalContent = (response: OpenAI.Responses.Response): boolean => {
  for (const outputItem of response.output) {
    if (outputItem.type !== 'message') continue
    for (const content of outputItem.content) {
      if (content.type === 'refusal') return true
    }
  }
  return false
}

export const getResponseSummary = (response: OpenAI.Responses.Response) => ({
  responseId: response.id,
  responseStatus: response.status,
  incompleteReason: response.incomplete_details?.reason,
  responseErrorCode: response.error?.code,
  hasOutputText: response.output_text.length > 0,
  outputItemCount: response.output.length,
  firstOutputItemType: response.output[0]?.type,
  firstContentType:
    response.output[0]?.type === 'message' && response.output[0].content.length > 0
      ? response.output[0].content[0]?.type
      : undefined,
})

export const classifyOutputIssue = (
  response: OpenAI.Responses.Response,
  emptyOutputDetail: string
): { kind: AiProviderErrorKind; detail: string } => {
  if (response.error !== null) {
    return {
      kind: 'response_error',
      detail: `OpenAI response error: ${response.error.code} ${response.error.message}`,
    }
  }

  if (response.status === 'incomplete') {
    return {
      kind: 'incomplete',
      detail:
        response.incomplete_details?.reason === undefined
          ? 'OpenAI response is incomplete.'
          : `OpenAI response is incomplete: ${response.incomplete_details.reason}.`,
    }
  }

  if (hasRefusalContent(response)) {
    return {
      kind: 'refusal',
      detail: 'OpenAI response was refused.',
    }
  }

  return {
    kind: 'empty_output',
    detail: emptyOutputDetail,
  }
}

export const getUsageTotalTokens = (response: OpenAI.Responses.Response): number | null => {
  const totalTokens = response.usage?.total_tokens
  if (typeof totalTokens !== 'number' || !Number.isInteger(totalTokens) || totalTokens < 0) return null
  return totalTokens
}
