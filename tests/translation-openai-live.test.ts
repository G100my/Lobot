import { describe, expect, it } from 'vitest'
import { translateText } from '../netlify/functions/providers/ai/chatgpt/translation'

const hasOpenAiApiKey = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.length > 0
const describeLive = hasOpenAiApiKey ? describe : describe.skip

describeLive('translation-openai-live', () => {
  it(
    'returns non-empty translations for configured languages',
    async () => {
      const configuredLanguages = ['zh-TW', 'en', 'ja']

      const result = await translateText({
        text: '早安，祝你今天順利。',
        languages: configuredLanguages,
        model: process.env.OPENAI_MODEL ?? 'gpt-5-nano',
        openaiApiKey: process.env.OPENAI_API_KEY as string,
        maxOutputTokens: 400,
      })
      console.log('[translation-openai-live] API result:')
      console.log(JSON.stringify(result, null, 2))

      expect(result.translations.length).toBeGreaterThan(0)
      expect(result.usageTotalTokens).toBeGreaterThan(0)

      for (const translation of result.translations) {
        expect(configuredLanguages).toContain(translation.language)
        expect(translation.text.trim().length).toBeGreaterThan(0)
      }
    },
    60_000
  )
})
