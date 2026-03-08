import type { MessageEvent, TextEventMessage } from '@line/bot-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../netlify/functions/line-webhook/chat-settings', () => ({
  getChatSetting: vi.fn(),
  setChatSetting: vi.fn(),
}))

vi.mock('../netlify/functions/line-webhook/token-usage', () => ({
  getDailyTokenUsage: vi.fn(),
  addDailyTokenUsage: vi.fn(),
}))

import { resolveLineReplyText } from '../netlify/functions/line-webhook/handle-line-inbound-message'
import { getChatSetting, setChatSetting } from '../netlify/functions/line-webhook/chat-settings'
import { addDailyTokenUsage, getDailyTokenUsage } from '../netlify/functions/line-webhook/token-usage'
import type { ChatTranslationSetting, TranslateTask } from '../netlify/functions/line-webhook/types'

type TextMessageEvent = MessageEvent & { message: TextEventMessage }

const createEnvironment = () => ({
  channelSecret: 'test-secret',
  channelAccessToken: 'test-token',
  openaiApiKey: 'openai-key',
  openaiModel: 'gpt-5-nano',
  openaiMaxOutputTokens: 200,
  openaiDailyTokenLimit: 5000,
})

const createTextMessageEvent = (text: string, overrides: Partial<TextMessageEvent> = {}): TextMessageEvent => ({
  type: 'message',
  mode: 'active',
  timestamp: Date.parse('2026-03-07T00:00:00.000Z'),
  webhookEventId: 'evt-1',
  deliveryContext: {
    isRedelivery: false,
  },
  source: {
    type: 'user',
    userId: 'Uline-flow-user',
  },
  replyToken: 'reply-token-1',
  message: {
    id: 'msg-1',
    type: 'text',
    text,
  },
  ...overrides,
})

describe('line-flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-07T00:00:00.000Z'))

    vi.mocked(getChatSetting).mockReset()
    vi.mocked(setChatSetting).mockReset()
    vi.mocked(getDailyTokenUsage).mockReset()
    vi.mocked(addDailyTokenUsage).mockReset()

    vi.mocked(getChatSetting).mockResolvedValue(null)
    vi.mocked(setChatSetting).mockResolvedValue(undefined)
    vi.mocked(getDailyTokenUsage).mockResolvedValue(0)
    vi.mocked(addDailyTokenUsage).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves #set language configuration and returns success reply', async () => {
    const savedSettings: ChatTranslationSetting[] = []

    vi.mocked(getChatSetting).mockResolvedValue({
      scopeType: 'group',
      scopeId: 'Cgroup123456',
      languages: ['zh-TW'],
      isQuiet: true,
      updatedAt: '2026-03-07T00:00:00.000Z',
      updatedByUserId: 'Uauthor12345678901234567890123456',
    })

    vi.mocked(setChatSetting).mockImplementation(async (_scope, setting) => {
      savedSettings.push(setting)
    })

    const reply = await resolveLineReplyText({
      event: createTextMessageEvent('#set zh-TW ja en', {
        source: {
          type: 'group',
          groupId: 'Cgroup123456',
          userId: 'Uauthor12345678901234567890123456',
        },
      }),
      environment: createEnvironment(),
      aiProvider: null,
    })

    expect(savedSettings).toEqual([
      {
        scopeType: 'group',
        scopeId: 'Cgroup123456',
        languages: ['zh-TW', 'ja', 'en'],
        isQuiet: true,
        updatedAt: '2026-03-07T00:00:00.000Z',
        updatedByUserId: 'Uauthor12345678901234567890123456',
      },
    ])
    expect(reply).toBe('已更新此聊天室翻譯設定：zh-TW, ja, en\n之後收到一般訊息，會翻譯成其餘語言。')
  })

  it('translates configured target languages and returns joined text', async () => {
    const aiTasks: TranslateTask[] = []
    const tokenUsageDeltas: number[] = []
    const environment = createEnvironment()

    vi.mocked(getChatSetting).mockResolvedValue({
      scopeType: 'user',
      scopeId: 'Uline-flow-user',
      languages: ['zh-TW', 'ja', 'en'],
      toneName: '像專業客服一樣禮貌',
      isQuiet: false,
      updatedAt: '2026-03-07T00:00:00.000Z',
      updatedByUserId: 'Uline-flow-user',
    })

    vi.mocked(addDailyTokenUsage).mockImplementation(async (_scope, _nowIso, deltaTokens) => {
      tokenUsageDeltas.push(deltaTokens)
    })

    const reply = await resolveLineReplyText({
      event: createTextMessageEvent('早安'),
      environment,
      aiProvider: {
        reply: async (task: TranslateTask) => {
          aiTasks.push(task)
          return {
            ok: true,
            data: {
              text: 'おはようございます\nGood morning',
              usageTotalTokens: 42,
            },
          }
        },
      },
    })

    expect(aiTasks).toEqual([
      {
        text: '早安',
        configuredLanguages: ['zh-TW', 'ja', 'en'],
        toneName: '像專業客服一樣禮貌',
        context: {
          requestId: 'evt-1',
          scopeType: 'user',
          scopeId: 'Uline-flow-user',
        },
      },
    ])
    expect(tokenUsageDeltas).toEqual([42])
    expect(reply).toBe('おはようございます\nGood morning')
  })

  it('saves #settone and returns success reply', async () => {
    const savedSettings: ChatTranslationSetting[] = []

    vi.mocked(getChatSetting).mockResolvedValue({
      scopeType: 'user',
      scopeId: 'Uline-flow-user',
      languages: ['zh-TW', 'en'],
      isQuiet: true,
      updatedAt: '2026-03-07T00:00:00.000Z',
      updatedByUserId: 'Uline-flow-user',
    })

    vi.mocked(setChatSetting).mockImplementation(async (_scope, setting) => {
      savedSettings.push(setting)
    })

    const reply = await resolveLineReplyText({
      event: createTextMessageEvent('#settone 像專業客服一樣禮貌'),
      environment: createEnvironment(),
      aiProvider: null,
    })

    expect(savedSettings).toEqual([
      {
        scopeType: 'user',
        scopeId: 'Uline-flow-user',
        languages: ['zh-TW', 'en'],
        toneName: '像專業客服一樣禮貌',
        isQuiet: true,
        updatedAt: '2026-03-07T00:00:00.000Z',
        updatedByUserId: 'Uline-flow-user',
      },
    ])
    expect(reply).toBe('已更新翻譯語氣：像專業客服一樣禮貌\n後續翻譯會套用此語氣。')
  })

  it('clears tone with #settone off', async () => {
    const savedSettings: ChatTranslationSetting[] = []

    vi.mocked(getChatSetting).mockResolvedValue({
      scopeType: 'user',
      scopeId: 'Uline-flow-user',
      languages: ['zh-TW', 'en'],
      toneName: '像專業客服一樣禮貌',
      isQuiet: false,
      updatedAt: '2026-03-07T00:00:00.000Z',
      updatedByUserId: 'Uline-flow-user',
    })

    vi.mocked(setChatSetting).mockImplementation(async (_scope, setting) => {
      savedSettings.push(setting)
    })

    const reply = await resolveLineReplyText({
      event: createTextMessageEvent('#settone off'),
      environment: createEnvironment(),
      aiProvider: null,
    })

    expect(savedSettings).toEqual([
      {
        scopeType: 'user',
        scopeId: 'Uline-flow-user',
        languages: ['zh-TW', 'en'],
        isQuiet: false,
        updatedAt: '2026-03-07T00:00:00.000Z',
        updatedByUserId: 'Uline-flow-user',
      },
    ])
    expect(reply).toBe('已清除翻譯語氣設定，後續會使用預設語氣翻譯。')
  })

  it('returns #lang help when quiet mode is enabled', async () => {
    vi.mocked(getChatSetting).mockResolvedValue({
      scopeType: 'user',
      scopeId: 'Uline-flow-user',
      languages: ['zh-TW', 'en'],
      isQuiet: true,
      updatedAt: '2026-03-07T00:00:00.000Z',
      updatedByUserId: 'Uline-flow-user',
    })

    const reply = await resolveLineReplyText({
      event: createTextMessageEvent('#lang'),
      environment: createEnvironment(),
      aiProvider: null,
    })

    expect(reply).toContain('範例：#set zh-TW ja en')
  })

  it('treats !setrole text as normal message (no command handling)', async () => {
    const aiTasks: TranslateTask[] = []

    vi.mocked(getChatSetting).mockResolvedValue({
      scopeType: 'user',
      scopeId: 'Uline-flow-user',
      languages: ['zh-TW', 'en'],
      isQuiet: false,
      updatedAt: '2026-03-07T00:00:00.000Z',
      updatedByUserId: 'Uline-flow-user',
    })

    const reply = await resolveLineReplyText({
      event: createTextMessageEvent('!setrole off'),
      environment: createEnvironment(),
      aiProvider: {
        reply: async (task: TranslateTask) => {
          aiTasks.push(task)
          return {
            ok: true,
            data: {
              text: 'translated',
              usageTotalTokens: 10,
            },
          }
        },
      },
    })

    expect(vi.mocked(setChatSetting)).not.toHaveBeenCalled()
    expect(aiTasks).toEqual([
      {
        text: '!setrole off',
        configuredLanguages: ['zh-TW', 'en'],
        toneName: undefined,
        context: {
          requestId: 'evt-1',
          scopeType: 'user',
          scopeId: 'Uline-flow-user',
        },
      },
    ])
    expect(reply).toBe('translated')
  })
})
