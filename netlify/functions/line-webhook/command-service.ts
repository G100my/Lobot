import type { MessageEvent, TextEventMessage } from '@line/bot-sdk'
import { z } from 'zod'
import {
  COMMAND_ACTIVE,
  COMMAND_LANG,
  COMMAND_QUIET,
  COMMAND_SET,
  COMMAND_SET_TONE,
  LANGUAGE_CODE_LABELS,
  MAX_SET_LANGUAGE_ITEM_LENGTH,
  MAX_SET_LANGUAGE_ITEMS,
  MAX_TONE_NAME_CHARACTERS,
  SUPPORTED_SET_LANGUAGE_CODES,
} from './constants'
import { setChatSetting } from './chat-settings'
import { logErrorWithContext, type ThrownError } from '../shared/error-logging'
import type { ChatScope, ChatTranslationSetting } from './types'

type TextMessageEvent = MessageEvent & { message: TextEventMessage }
type CommandHandlerResult = string | null | undefined

const setCommandSchema = z.object({
  command: z.literal(COMMAND_SET, { error: '指令開頭必須是 #set。' }),
  languages: z
    .array(
      z
        .string()
        .max(MAX_SET_LANGUAGE_ITEM_LENGTH, { error: `語言項目長度不可超過 ${MAX_SET_LANGUAGE_ITEM_LENGTH} 字元。` })
    )
    .min(1, { error: '至少需要 1 個語言項目。' })
    .max(MAX_SET_LANGUAGE_ITEMS, { error: `語言項目數量不可超過 ${MAX_SET_LANGUAGE_ITEMS}。` }),
})

const setToneCommandSchema = z.object({
  command: z.literal(COMMAND_SET_TONE, { error: '指令開頭必須是 #settone。' }),
  toneTokens: z.array(z.string()).min(1, { error: '請提供語氣描述，或使用 #settone off 清除語氣。' }),
})

const toneNameSchema = z
  .string()
  .trim()
  .min(1, { error: '語氣描述不可為空。' })
  .max(MAX_TONE_NAME_CHARACTERS, { error: `語氣描述長度不可超過 ${MAX_TONE_NAME_CHARACTERS} 字元。` })

const supportedLanguageCodeSchema = z.enum(SUPPORTED_SET_LANGUAGE_CODES)

const normalizeLanguageCode = (language: string): string => {
  const lowerCasedLanguage = language.toLowerCase()
  switch (lowerCasedLanguage) {
    case 'zh-tw':
      return 'zh-TW'
    case 'zh-cn':
      return 'zh-CN'
    default:
      return lowerCasedLanguage
  }
}

const parseSetCommand = (text: string): { languages: string[] } | { reason: string } => {
  const trimmedText = text.trim()
  if (!trimmedText.startsWith(COMMAND_SET)) {
    return { reason: '指令開頭必須是 #set。' }
  }

  const tokens = trimmedText.split(/\s+/)
  const parsed = setCommandSchema.safeParse({
    command: tokens[0],
    languages: tokens.slice(1),
  })

  if (!parsed.success) {
    return {
      reason: parsed.error.issues[0]?.message ?? '設定失敗：指令格式不正確。',
    }
  }

  const normalizedLanguages: string[] = []
  const languageSet = new Set<string>()

  for (const rawLanguage of parsed.data.languages) {
    const normalizedLanguage = normalizeLanguageCode(rawLanguage)

    if (!supportedLanguageCodeSchema.safeParse(normalizedLanguage).success) {
      return {
        reason: `語言代碼「${rawLanguage}」無效。可輸入 #lang 查詢常用語碼。`,
      }
    }

    if (languageSet.has(normalizedLanguage)) {
      return {
        reason: `語言項目重複：${normalizedLanguage}`,
      }
    }

    languageSet.add(normalizedLanguage)
    normalizedLanguages.push(normalizedLanguage)
  }

  return {
    languages: normalizedLanguages,
  }
}

const parseSetToneCommand = (text: string): { toneName: string | null } | { reason: string } => {
  const trimmedText = text.trim()
  if (!trimmedText.startsWith(COMMAND_SET_TONE)) {
    return { reason: '指令開頭必須是 #settone。' }
  }

  const tokens = trimmedText.split(/\s+/)
  const parsed = setToneCommandSchema.safeParse({
    command: tokens[0],
    toneTokens: tokens.slice(1),
  })

  if (!parsed.success) {
    return {
      reason: parsed.error.issues[0]?.message ?? '語氣設定失敗：指令格式不正確。',
    }
  }

  const { toneTokens } = parsed.data
  if (toneTokens.length === 1 && toneTokens[0].toLowerCase() === 'off') {
    return {
      toneName: null,
    }
  }

  const parsedToneName = toneNameSchema.safeParse(toneTokens.join(' '))
  if (!parsedToneName.success) {
    return {
      reason: parsedToneName.error.issues[0]?.message ?? '語氣設定失敗：語氣描述格式不正確。',
    }
  }

  return {
    toneName: parsedToneName.data,
  }
}

type CommandMessageInput =
  | { kind: 'set_success'; languages: string[] }
  | { kind: 'set_error'; reason: string }
  | { kind: 'lang_help' }
  | { kind: 'set_tone_success'; toneName: string | null }
  | { kind: 'set_tone_error'; reason: string }

const buildCommandMessage = (input: CommandMessageInput): string => {
  switch (input.kind) {
    case 'set_success': {
      const joined = input.languages.join(', ')
      return `已更新此聊天室翻譯設定：${joined}\n之後收到一般訊息，會翻譯成其餘語言。`
    }
    case 'set_error':
      return `設定失敗：${input.reason}\n正確格式：#set zh-TW ja en\n可輸入 #lang 查詢常用語碼。`
    case 'lang_help': {
      const lines = SUPPORTED_SET_LANGUAGE_CODES.map((code) => `${code}：${LANGUAGE_CODE_LABELS[code]}`)
      lines.push('')
      lines.push('範例：#set zh-TW ja en')
      return lines.join('\n')
    }
    case 'set_tone_success':
      return input.toneName === null
        ? '已清除翻譯語氣設定，後續會使用預設語氣翻譯。'
        : `已更新翻譯語氣：${input.toneName}\n後續翻譯會套用此語氣。`
    case 'set_tone_error':
      return `語氣設定失敗：${input.reason}\n正確格式：#settone 語氣描述（清除請用：#settone off）`
  }
}

const buildReplyModeSetting = (
  chatScope: ChatScope,
  chatSetting: ChatTranslationSetting | null,
  event: TextMessageEvent,
  isQuiet: boolean
): ChatTranslationSetting => {
  const toneNamePatch = chatSetting?.toneName === undefined ? {} : { toneName: chatSetting.toneName }
  return {
    scopeType: chatScope.scopeType,
    scopeId: chatScope.scopeId,
    languages: chatSetting?.languages ?? [],
    isQuiet,
    updatedAt: new Date().toISOString(),
    updatedByUserId: event.source.userId,
    ...toneNamePatch,
  }
}

const handleReplyModeCommand = async (
  isQuiet: boolean,
  chatScope: ChatScope,
  chatSetting: ChatTranslationSetting | null,
  event: TextMessageEvent
): Promise<CommandHandlerResult> => {
  const setting = buildReplyModeSetting(chatScope, chatSetting, event, isQuiet)
  try {
    await setChatSetting(chatScope, setting)
  } catch (error) {
    logErrorWithContext(
      '[line-webhook] Failed to save reply mode setting.',
      { webhookEventId: event.webhookEventId },
      error as ThrownError
    )
  }

  return null
}

const handleLangCommand = (): CommandHandlerResult => buildCommandMessage({ kind: 'lang_help' })

const handleSetToneCommand = async (
  chatScope: ChatScope,
  chatSetting: ChatTranslationSetting | null,
  event: TextMessageEvent
): Promise<CommandHandlerResult> => {
  const setToneCommand = parseSetToneCommand(event.message.text)
  if ('reason' in setToneCommand) {
    return buildCommandMessage({
      kind: 'set_tone_error',
      reason: setToneCommand.reason,
    })
  }

  const toneNamePatch = setToneCommand.toneName === null ? {} : { toneName: setToneCommand.toneName }
  const setting: ChatTranslationSetting = {
    scopeType: chatScope.scopeType,
    scopeId: chatScope.scopeId,
    languages: chatSetting?.languages ?? [],
    isQuiet: chatSetting?.isQuiet ?? false,
    updatedAt: new Date().toISOString(),
    updatedByUserId: event.source.userId,
    ...toneNamePatch,
  }

  try {
    await setChatSetting(chatScope, setting)
    return buildCommandMessage({
      kind: 'set_tone_success',
      toneName: setToneCommand.toneName,
    })
  } catch (error) {
    logErrorWithContext(
      '[line-webhook] Failed to save #settone setting.',
      { webhookEventId: event.webhookEventId },
      error as ThrownError
    )
    return '語氣設定儲存失敗，請稍後再試一次。'
  }
}

const handleSetCommand = async (
  chatScope: ChatScope,
  chatSetting: ChatTranslationSetting | null,
  event: TextMessageEvent
): Promise<CommandHandlerResult> => {
  const setCommand = parseSetCommand(event.message.text)
  if ('reason' in setCommand) {
    return buildCommandMessage({
      kind: 'set_error',
      reason: setCommand.reason,
    })
  }

  const toneNamePatch = chatSetting?.toneName === undefined ? {} : { toneName: chatSetting.toneName }
  const setting: ChatTranslationSetting = {
    scopeType: chatScope.scopeType,
    scopeId: chatScope.scopeId,
    languages: setCommand.languages,
    isQuiet: chatSetting?.isQuiet ?? false,
    updatedAt: new Date().toISOString(),
    updatedByUserId: event.source.userId,
    ...toneNamePatch,
  }

  try {
    await setChatSetting(chatScope, setting)
    return buildCommandMessage({
      kind: 'set_success',
      languages: setCommand.languages,
    })
  } catch (error) {
    logErrorWithContext(
      '[line-webhook] Failed to save #set setting.',
      { webhookEventId: event.webhookEventId },
      error as ThrownError
    )
    return '設定儲存失敗，請稍後再試一次。'
  }
}

export const handleCommand = async (
  commandToken: string,
  chatScope: ChatScope,
  chatSetting: ChatTranslationSetting | null,
  event: TextMessageEvent
): Promise<CommandHandlerResult> => {
  switch (commandToken) {
    case COMMAND_QUIET:
      return await handleReplyModeCommand(true, chatScope, chatSetting, event)
    case COMMAND_ACTIVE:
      return await handleReplyModeCommand(false, chatScope, chatSetting, event)
    case COMMAND_LANG:
      return handleLangCommand()
    case COMMAND_SET_TONE:
      return await handleSetToneCommand(chatScope, chatSetting, event)
    case COMMAND_SET:
      return await handleSetCommand(chatScope, chatSetting, event)
    default:
      return undefined
  }
}
