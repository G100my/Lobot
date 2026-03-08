import type { MessageEvent, TextEventMessage } from '@line/bot-sdk'
import { GET_ENV, MAX_TRANSLATION_INPUT_CHARACTERS } from './constants'
import { getChatSetting } from './chat-settings'
import { handleCommand } from './command-service'
import { addDailyTokenUsage, getDailyTokenUsage } from './token-usage'
import { logErrorWithContext, type ThrownError } from '../shared/error-logging'
import type { AiProvider, ChatScope, ChatTranslationSetting, TranslateTask } from './types'

type TextMessageEvent = MessageEvent & { message: TextEventMessage }

interface HandleLineInboundMessageInput {
  event: TextMessageEvent
  environment: NonNullable<ReturnType<typeof GET_ENV>>
  aiProvider: AiProvider | null
}

const resolveChatScope = (event: TextMessageEvent): ChatScope | null => {
  switch (event.source.type) {
    case 'user':
      return {
        scopeType: 'user',
        scopeId: event.source.userId,
      }
    case 'group':
      if (!event.source.groupId) return null
      return {
        scopeType: 'group',
        scopeId: event.source.groupId,
      }
    case 'room':
      if (!event.source.roomId) return null
      return {
        scopeType: 'room',
        scopeId: event.source.roomId,
      }
  }
}

const resolveAiTranslationReply = async (
  input: HandleLineInboundMessageInput,
  chatScope: ChatScope,
  chatSetting: ChatTranslationSetting
): Promise<string | null> => {
  const { event, environment, aiProvider } = input

  if (aiProvider === null) {
    console.error('[line-webhook] OPENAI_API_KEY is missing, ai reply skipped.', {
      webhookEventId: event.webhookEventId,
    })
    return null
  }

  if (chatSetting.languages.length < 1) {
    return null
  }

  const quotaTimestamp = new Date().toISOString()
  let dailyTokenUsage: number
  try {
    dailyTokenUsage = await getDailyTokenUsage(chatScope, quotaTimestamp)
  } catch (error) {
    logErrorWithContext(
      '[line-webhook] Failed to read daily token usage.',
      { webhookEventId: event.webhookEventId },
      error as ThrownError
    )
    return null
  }

  if (dailyTokenUsage >= environment.openaiDailyTokenLimit) {
    return '今日翻譯額度已用完，請明天再試。'
  }

  const providerErrorContext = {
    webhookEventId: event.webhookEventId,
    scopeType: chatScope.scopeType,
    scopeId: chatScope.scopeId,
    model: environment.openaiModel,
  }

  const translateTask: TranslateTask = {
    text: event.message.text,
    configuredLanguages: chatSetting.languages,
    toneName: chatSetting.toneName,
    context: {
      requestId: event.webhookEventId,
      scopeType: chatScope.scopeType,
      scopeId: chatScope.scopeId,
    },
  }

  try {
    const providerResult = await aiProvider.reply(translateTask)
    if (!providerResult.ok) {
      logErrorWithContext(
        '[line-webhook] AI reply failed.',
        {
          ...providerErrorContext,
          providerErrorKind: providerResult.error.kind,
          providerResponseId: providerResult.error.metadata?.providerResponseId,
          providerStatus: providerResult.error.metadata?.providerStatus,
          providerIncompleteReason: providerResult.error.metadata?.incompleteReason,
          providerErrorCode: providerResult.error.metadata?.providerErrorCode,
        },
        new Error(providerResult.error.message),
        { includeStack: false }
      )
      return null
    }

    try {
      await addDailyTokenUsage(chatScope, quotaTimestamp, providerResult.data.usageTotalTokens)
    } catch (error) {
      logErrorWithContext(
        '[line-webhook] Failed to update daily token usage.',
        { webhookEventId: event.webhookEventId },
        error as ThrownError
      )
    }

    const replyText = providerResult.data.text.trim()
    if (replyText.length === 0) {
      return null
    }

    return replyText
  } catch (error) {
    logErrorWithContext('[line-webhook] AI reply failed.', providerErrorContext, error as ThrownError, {
      includeStack: false,
    })
    return null
  }
}

export const resolveLineReplyText = async (input: HandleLineInboundMessageInput): Promise<string | null> => {
  const { event } = input
  const chatScope = resolveChatScope(event)

  if (chatScope === null) {
    console.error('[line-webhook] Cannot resolve chat scope.', {
      webhookEventId: event.webhookEventId,
    })
    return null
  }

  const chatSetting = await getChatSetting(chatScope)

  const trimmedText = event.message.text.trim()
  const commandToken = trimmedText.split(/\s+/)[0]
  const commandResult = await handleCommand(commandToken, chatScope, chatSetting, event)
  if (commandResult !== undefined) {
    return commandResult
  }

  if (chatSetting === null) return null
  if (chatSetting.isQuiet === true) return null

  const characterCount = Array.from(event.message.text).length
  if (characterCount > MAX_TRANSLATION_INPUT_CHARACTERS) {
    return `翻譯失敗：輸入長度超過限制（最多 ${MAX_TRANSLATION_INPUT_CHARACTERS} 字元）。`
  }

  return await resolveAiTranslationReply(input, chatScope, chatSetting)
}
