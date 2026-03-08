import { getStore } from '@netlify/blobs'
import { z } from 'zod'
import { CHAT_SETTINGS_STORE_NAME } from './constants'
import type { ChatScope, ChatTranslationSetting } from './types'

const ChatSettingSchema = z.object({
  scopeType: z.enum(['user', 'group', 'room']),
  scopeId: z.string().trim().min(1),
  languages: z.array(z.string().trim().min(1)),
  isQuiet: z.boolean().optional().default(false),
  toneName: z.string().trim().min(1).optional(),
  updatedAt: z.string().trim().min(1),
  updatedByUserId: z.string().trim().optional(),
})

export const getChatSetting = async (scope: ChatScope): Promise<ChatTranslationSetting | null> => {
  const settingsStore = getStore(CHAT_SETTINGS_STORE_NAME)
  const key = `${scope.scopeType}:${scope.scopeId}`
  const rawValue = await settingsStore.get(key)

  if (!rawValue) {
    return null
  }

  const serialized = typeof rawValue === 'string' ? rawValue : new TextDecoder().decode(rawValue)

  try {
    const candidate = JSON.parse(serialized) as unknown
    const parsed = ChatSettingSchema.safeParse(candidate)
    if (!parsed.success) {
      return null
    }

    return parsed.data
  } catch {
    return null
  }
}

export const setChatSetting = async (scope: ChatScope, setting: ChatTranslationSetting): Promise<void> => {
  const settingsStore = getStore(CHAT_SETTINGS_STORE_NAME)
  const key = `${scope.scopeType}:${scope.scopeId}`
  const parsedSetting = ChatSettingSchema.safeParse(setting)

  if (!parsedSetting.success) {
    throw new Error('Invalid chat setting payload.')
  }
  if (parsedSetting.data.scopeType !== scope.scopeType || parsedSetting.data.scopeId !== scope.scopeId) {
    throw new Error('Chat setting scope does not match key scope.')
  }

  await settingsStore.set(key, JSON.stringify(parsedSetting.data))
}
