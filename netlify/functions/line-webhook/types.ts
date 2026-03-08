type ChatScopeType = 'user' | 'group' | 'room'

export interface ChatScope {
  scopeType: ChatScopeType
  scopeId: string
}

export interface ChatTranslationSetting extends ChatScope {
  languages: string[]
  isQuiet?: boolean
  toneName?: string
  updatedAt: string
  updatedByUserId?: string
}

interface AiTaskContext {
  requestId: string
  scopeType: ChatScopeType
  scopeId: string
}

export interface TranslateTask {
  text: string
  configuredLanguages: string[]
  toneName?: string
  context: AiTaskContext
}

export type AiProviderErrorKind =
  | 'request_error'
  | 'response_error'
  | 'incomplete'
  | 'refusal'
  | 'empty_output'
  | 'schema_parse_error'
  | 'usage_error'

export interface AiProviderError {
  kind: AiProviderErrorKind
  message: string
  retryable: boolean
  metadata?: {
    providerResponseId?: string
    providerStatus?: string
    incompleteReason?: string
    providerErrorCode?: string
  }
}

export type AiProviderResult<T> = { ok: true; data: T } | { ok: false; error: AiProviderError }

export interface AiReplyData {
  text: string
  usageTotalTokens: number
}

export interface AiProvider {
  reply(task: TranslateTask): Promise<AiProviderResult<AiReplyData>>
}
