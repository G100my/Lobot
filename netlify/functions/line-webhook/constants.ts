export const SIGNATURE_HEADER_NAME = 'x-line-signature'
export const COMMAND_SET = '#set'
export const COMMAND_LANG = '#lang'
export const COMMAND_QUIET = '#quiet'
export const COMMAND_ACTIVE = '#active'
export const COMMAND_SET_TONE = '#settone'
export const DEFAULT_OPENAI_MODEL = 'gpt-5-nano'
export const CHAT_SETTINGS_STORE_NAME = 'line-chat-settings'
export const TOKEN_USAGE_STORE_NAME = 'line-token-usage'
export const MAX_SET_LANGUAGE_ITEMS = 6
export const MAX_SET_LANGUAGE_ITEM_LENGTH = 20
export const MAX_TONE_NAME_CHARACTERS = 24
export const MAX_TRANSLATION_INPUT_CHARACTERS = 240
export const MAX_PREFIX_LANGUAGE_CHARACTERS = 4
export const OPENAI_MAX_OUTPUT_TOKENS_DEFAULT = 400
export const OPENAI_DAILY_TOKEN_LIMIT_DEFAULT = 5000
export const TRANSLATION_SINGLE_PASS_INSTRUCTIONS =
  [
    'You are a deterministic translation engine.',
    'Return ONLY JSON that matches the provided schema.',
    'Task: translate the input text into required target languages.',
    'Rules:',
    '- Output must contain only schema-defined keys.',
    '- Output translations as an array of objects: { language, text }.',
    '- language must use only the provided target language codes from input.',
    '- Detect source language internally and do not output an item whose language equals source language.',
    '- text must be translated plain text only.',
    '- No markdown, labels, code fences, emojis, explanations, or extra keys.',
    '- Preserve meaning and requested tone.',
  ].join('\n')

export const SUPPORTED_SET_LANGUAGE_CODES = [
  'zh-TW',
  'zh-CN',
  'ja',
  'en',
  'ko',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'ru',
  'th',
  'vi',
  'id',
  'ms',
  'ar',
  'hi',
] as const

export const LANGUAGE_CODE_LABELS: Readonly<Record<(typeof SUPPORTED_SET_LANGUAGE_CODES)[number], string>> = {
  'zh-TW': '繁體中文',
  'zh-CN': '簡體中文',
  ja: '日文',
  en: '英文',
  ko: '韓文',
  fr: '法文',
  de: '德文',
  es: '西班牙文',
  it: '義大利文',
  pt: '葡萄牙文',
  ru: '俄文',
  th: '泰文',
  vi: '越南文',
  id: '印尼文',
  ms: '馬來文',
  ar: '阿拉伯文',
  hi: '印地文',
}

const parsePositiveIntegerEnvironmentVariable = (rawValue: string | undefined, defaultValue: number): number | null => {
  if (rawValue === undefined) return defaultValue

  const parsedValue = Number(rawValue)
  if (!Number.isInteger(parsedValue) || parsedValue < 1) return null

  return parsedValue
}

export const GET_ENV = (): {
  channelSecret: string
  channelAccessToken: string
  openaiApiKey: string
  openaiModel: string
  openaiMaxOutputTokens: number
  openaiDailyTokenLimit: number
} => {
  const channelSecret = process.env.LINE_CHANNEL_SECRET
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN
  const openaiApiKey = process.env.OPENAI_API_KEY
  const openaiModel = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL
  const openaiMaxOutputTokens = parsePositiveIntegerEnvironmentVariable(
    process.env.OPENAI_MAX_OUTPUT_TOKENS,
    OPENAI_MAX_OUTPUT_TOKENS_DEFAULT
  )
  const openaiDailyTokenLimit = parsePositiveIntegerEnvironmentVariable(
    process.env.OPENAI_DAILY_TOKEN_LIMIT,
    OPENAI_DAILY_TOKEN_LIMIT_DEFAULT
  )

  const env = {
    channelSecret,
    channelAccessToken,
    openaiApiKey,
    openaiModel,
    openaiMaxOutputTokens,
    openaiDailyTokenLimit,
  }

  for (const [key, value] of Object.entries(env)) {
    if (!value) {
      throw new Error(`Missing or invalid environment variable: ${key}`)
    }
  }

  return env as NonNullable<ReturnType<typeof GET_ENV>>
}
