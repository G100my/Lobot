import OpenAI from 'openai'
import { z } from 'zod'
import { zodTextFormat } from 'openai/helpers/zod'

const buildSourceLanguageOutputSchema = () =>
  z.object({
    sourceLanguage: z.string().trim().min(1),
  })

const buildTargetTranslationsOutputSchema = (targetLanguages) => {
  const translationFields = {}
  for (const language of targetLanguages) {
    translationFields[language] = z.string().trim().min(1)
  }

  return z.object({
    translations: z.object(translationFields).strict(),
  })
}

const TRANSLATION_SOURCE_LANGUAGE_INSTRUCTIONS = [
  'You are a deterministic translation preprocessor.',
  'Return ONLY JSON that matches the provided schema.',
  'Task: detect the source language tag for the input text.',
  'Rules:',
  '- Output must contain only schema-defined keys.',
  '- Do not include markdown, code fences, or explanations.',
  '- Never add extra keys.',
].join('\n')

const TRANSLATION_TARGET_TRANSLATIONS_INSTRUCTIONS = [
  'You are a deterministic translation engine.',
  'Return ONLY JSON that matches the provided schema.',
  'Task: translate the input text into every required target language in translations.',
  'Rules:',
  '- The translations object keys are fixed by schema. Return all keys exactly once.',
  '- Each translations value must be only the translated sentence.',
  '- No labels, no language names, no prefixes, no brackets, no emoji, no quotes, no explanations.',
  '- Preserve meaning and requested tone.',
  '- Never include markdown, code fences, or extra keys.',
].join('\n')

const normalizeLanguageTag = (language) => language.trim().toLowerCase()

const computeTargetLanguages = (configuredLanguages, sourceLanguage) => {
  const normalizedSourceLanguage = normalizeLanguageTag(sourceLanguage)
  return configuredLanguages.filter((language) => normalizeLanguageTag(language) !== normalizedSourceLanguage)
}

const parseArgs = (argv) => {
  const parsed = {
    text: 'test',
    languages: ['zh-TW', 'en'],
    model: 'gpt-5-nano',
    maxOutputTokens: 400,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--text') {
      parsed.text = argv[i + 1] ?? parsed.text
      i += 1
      continue
    }
    if (arg === '--languages') {
      const raw = argv[i + 1] ?? ''
      parsed.languages = raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
      i += 1
      continue
    }
    if (arg === '--model') {
      parsed.model = argv[i + 1] ?? parsed.model
      i += 1
      continue
    }
    if (arg === '--max-output-tokens') {
      const raw = Number(argv[i + 1])
      if (Number.isInteger(raw) && raw > 0) {
        parsed.maxOutputTokens = raw
      }
      i += 1
      continue
    }
  }

  return parsed
}

const collectResponseShape = (response) => {
  const firstOutputItem = response.output[0]
  const firstOutputItemType = firstOutputItem?.type
  const firstContentType =
    firstOutputItem?.type === 'message' && firstOutputItem.content.length > 0
      ? firstOutputItem.content[0]?.type
      : undefined

  return {
    responseId: response.id,
    responseStatus: response.status,
    incompleteReason: response.incomplete_details?.reason,
    responseErrorCode: response.error?.code,
    hasOutputText: response.output_text.length > 0,
    outputItemCount: response.output.length,
    firstOutputItemType,
    firstContentType,
  }
}

const run = async () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required.')
  }

  const options = parseArgs(process.argv.slice(2))
  if (options.languages.length === 0) {
    throw new Error('At least one language is required.')
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const sourceResponse = await openai.responses.parse({
    model: options.model,
    max_output_tokens: options.maxOutputTokens,
    reasoning: {
      effort: 'minimal',
    },
    instructions: TRANSLATION_SOURCE_LANGUAGE_INSTRUCTIONS,
    input: `Text to analyze:\n${options.text}`,
    text: {
      format: zodTextFormat(buildSourceLanguageOutputSchema(), 'translation_source_language_live_test'),
    },
  })

  const sourceLanguage = sourceResponse.output_parsed?.sourceLanguage?.trim()
  if (typeof sourceLanguage !== 'string' || sourceLanguage.length === 0) {
    throw new Error('sourceLanguage parse failed.')
  }

  const targetLanguages = computeTargetLanguages(options.languages, sourceLanguage)
  let translationResponse = null
  if (targetLanguages.length > 0) {
    translationResponse = await openai.responses.parse({
      model: options.model,
      max_output_tokens: options.maxOutputTokens,
      reasoning: {
        effort: 'minimal',
      },
      instructions: TRANSLATION_TARGET_TRANSLATIONS_INSTRUCTIONS,
      input: `Target languages (ISO code list): ${targetLanguages.join(', ')}\nText to translate:\n${options.text}`,
      text: {
        format: zodTextFormat(
          buildTargetTranslationsOutputSchema(targetLanguages),
          'translation_target_languages_live_test'
        ),
      },
    })
  }

  const parsedTranslations = targetLanguages.length === 0 ? {} : (translationResponse?.output_parsed?.translations ?? {})

  console.log('Request options:')
  console.log(
    JSON.stringify(
      {
        text: options.text,
        languages: options.languages,
        model: options.model,
        maxOutputTokens: options.maxOutputTokens,
      },
      null,
      2
    )
  )

  console.log('Source response shape:')
  console.log(JSON.stringify(collectResponseShape(sourceResponse), null, 2))

  if (translationResponse) {
    console.log('Target translation response shape:')
    console.log(JSON.stringify(collectResponseShape(translationResponse), null, 2))
  }

  console.log('Parsed output:')
  console.log(
    JSON.stringify(
      {
        sourceLanguage,
        targetLanguages,
        translations: parsedTranslations,
      },
      null,
      2
    )
  )

  console.log('Usage:')
  console.log(
    JSON.stringify(
      {
        source: sourceResponse.usage,
        targetTranslations: translationResponse?.usage ?? null,
      },
      null,
      2
    )
  )
}

await run()
