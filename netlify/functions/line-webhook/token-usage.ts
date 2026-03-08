import { getStore } from '@netlify/blobs'
import { z } from 'zod'
import { TOKEN_USAGE_STORE_NAME } from './constants'
import type { ChatScope } from './types'

const DailyTokenUsageSchema = z.object({
  scopeType: z.enum(['user', 'group', 'room']),
  scopeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalTokens: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
})

const parseDailyTokenUsage = (rawValue: string) => {
  const candidate: unknown = JSON.parse(rawValue)
  const parsed = DailyTokenUsageSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new Error('Token usage record schema is invalid.')
  }

  return parsed.data
}

const resolveUtcDate = (nowIso: string): string => {
  const date = new Date(nowIso)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid timestamp for token usage.')
  }

  return date.toISOString().slice(0, 10)
}

const buildDailyTokenUsageKey = (scope: ChatScope, date: string): string =>
  `${scope.scopeType}:${scope.scopeId}:${date}`

const TOKEN_USAGE_WRITE_MAX_RETRIES = 8

const assertScopeAndDateMatch = (
  record: z.infer<typeof DailyTokenUsageSchema>,
  scope: ChatScope,
  date: string
): void => {
  if (record.scopeType !== scope.scopeType || record.scopeId !== scope.scopeId || record.date !== date) {
    throw new Error('Token usage record does not match requested scope/date.')
  }
}

export const getDailyTokenUsage = async (scope: ChatScope, nowIso: string): Promise<number> => {
  const date = resolveUtcDate(nowIso)
  const tokenUsageStore = getStore(TOKEN_USAGE_STORE_NAME)
  const rawValue = await tokenUsageStore.get(buildDailyTokenUsageKey(scope, date))

  if (!rawValue) {
    return 0
  }

  const record = parseDailyTokenUsage(typeof rawValue === 'string' ? rawValue : new TextDecoder().decode(rawValue))
  assertScopeAndDateMatch(record, scope, date)

  return record.totalTokens
}

export const addDailyTokenUsage = async (scope: ChatScope, nowIso: string, deltaTokens: number): Promise<void> => {
  if (!Number.isInteger(deltaTokens) || deltaTokens < 0) {
    throw new Error('Token usage delta must be a non-negative integer.')
  }

  if (deltaTokens === 0) {
    return
  }

  const date = resolveUtcDate(nowIso)
  const tokenUsageStore = getStore(TOKEN_USAGE_STORE_NAME)
  const key = buildDailyTokenUsageKey(scope, date)

  for (let attempt = 0; attempt < TOKEN_USAGE_WRITE_MAX_RETRIES; attempt += 1) {
    const existingEntry = await tokenUsageStore.getWithMetadata(key, { type: 'text' })

    if (existingEntry === null) {
      const createResult = await tokenUsageStore.set(
        key,
        JSON.stringify({
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          date,
          totalTokens: deltaTokens,
          updatedAt: nowIso,
        }),
        { onlyIfNew: true }
      )

      if (createResult.modified) {
        return
      }

      continue
    }

    const record = parseDailyTokenUsage(existingEntry.data)
    assertScopeAndDateMatch(record, scope, date)
    if (existingEntry.etag === undefined) {
      throw new Error('Token usage record is missing etag.')
    }

    const updateResult = await tokenUsageStore.set(
      key,
      JSON.stringify({
        ...record,
        totalTokens: record.totalTokens + deltaTokens,
        updatedAt: nowIso,
      }),
      { onlyIfMatch: existingEntry.etag }
    )

    if (updateResult.modified) {
      return
    }
  }

  throw new Error('Failed to update token usage due to concurrent writes.')
}
