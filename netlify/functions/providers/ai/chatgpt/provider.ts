import { TranslateTextStageError, translateText } from './translation'
import type { AiReplyData, AiProvider, AiProviderErrorKind, AiProviderResult, TranslateTask } from '../../../line-webhook/types'

interface ChatGptProviderConfig {
  model: string
  openaiApiKey: string
  maxOutputTokens: number
}

const isRetryableError = (kind: AiProviderErrorKind): boolean => {
  return kind === 'request_error' || kind === 'incomplete'
}

export const createChatGptProvider = (config: ChatGptProviderConfig): AiProvider => {
  return {
    reply: async (task: TranslateTask): Promise<AiProviderResult<AiReplyData>> => {
      try {
        const result = await translateText({
          text: task.text,
          languages: task.configuredLanguages,
          toneName: task.toneName,
          model: config.model,
          openaiApiKey: config.openaiApiKey,
          maxOutputTokens: config.maxOutputTokens,
        })

        return {
          ok: true,
          data: {
            text: result.translations.map((item) => item.text).join('\n'),
            usageTotalTokens: result.usageTotalTokens,
          },
        }
      } catch (error) {
        if (error instanceof TranslateTextStageError) {
          return {
            ok: false,
            error: {
              kind: error.kind,
              message: error.message,
              retryable: isRetryableError(error.kind),
              metadata:
                error.response === undefined
                  ? undefined
                  : {
                      providerResponseId: error.response.id,
                      providerStatus: error.response.status,
                      incompleteReason: error.response.incomplete_details?.reason,
                      providerErrorCode: error.response.error?.code,
                    },
            },
          }
        }

        throw error
      }
    },
  }
}
