# Lobot

## LINE Webhook on Netlify

### Architecture

This project is split into 3 major blocks:

- `netlify/functions/line-webhook/*`
  - LINE webhook handling, command parsing/handling, chat setting store, token usage store, runtime constants/types
- `netlify/functions/providers/ai/chatgpt/*`
  - OpenAI translation provider implementation
- `netlify/functions/shared/*`
  - Shared helpers (e.g. error logging, HTTP response helper)

Netlify entrypoint:

- `netlify/functions/line-webhook.ts`

### Environment variables

Copy `.env` values into your Netlify environment variables:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, default: `gpt-5-nano`)
- `OPENAI_MAX_OUTPUT_TOKENS` (optional, default: `400`)
- `OPENAI_DAILY_TOKEN_LIMIT` (optional, default: `5000`)

### Local development

```bash
pnpm dev
```

Local webhook endpoint:

`http://localhost:8888/api/line/webhook`

This route is configured in the function file via `config.path`.

### Deploy setup

1. Deploy to Netlify.
2. Set environment variables in Netlify site settings.
3. In LINE Developers Console, set webhook URL:
   - `https://<your-site>.netlify.app/api/line/webhook`
4. Enable webhook and run Verify.

### Behavior

- Accepts `POST /api/line/webhook`
- Verifies `x-line-signature`
- Handles only `message/text` events
- `#set` command updates translation target languages for current chat scope
  - Example: `#set zh-TW ja en`
  - Language codes are validated against a common list (`ja`, `en`, `ko`, `fr`, `de`, `es`, `it`, `pt`, `ru`, `th`, `vi`, `id`, `ms`, `ar`, `hi`, plus `zh-TW`, `zh-CN`)
- `#lang` command shows common supported language codes
- `#quiet` command mutes translate replies for current chat scope
- `#active` command resumes translation replies for current chat scope
- `#settone <tone>` sets translation tone for current chat scope
  - Example: `#settone 像專業客服一樣禮貌`
  - `#settone off` clears translation tone setting
- `!setrole` is not a command and will be treated as normal message text
- Setting scope is per chat ID:
  - 1:1 chat uses `userId`
  - group chat uses `groupId`
  - multi-person room uses `roomId`
- If chat has no `#set` configuration, bot does not reply
- If configured language list is empty, bot skips translation and does not call OpenAI API
- If chat has configuration, bot translates input text to all other configured languages
- If `#settone` is configured, translation output follows that tone across all target languages
- Translation response format:
  - Outputs plain translated text only (no language prefix, no flag)
  - When multiple targets exist, outputs one translated line per target in configured `#set` order
  - If OpenAI output violates translation schema contract, bot skips reply and logs provider error

### Translation schema contract

- Source language stage:
  - Output must be JSON schema-compatible with `sourceLanguage` as non-empty string
- Target translation stage:
  - Output must be JSON schema-compatible with `translations` object keys matching requested target languages
- Any schema parse violation is treated as provider error (no fallback text, no silent recovery)

### Limits

- `#set` command:
  - At least `1` language item
  - At most `6` language items
  - Each item length: up to `20` characters
  - Duplicate items are rejected
  - Unsupported language codes are rejected
- Translation input text:
  - Unified limit for all languages: up to `240` characters
- OpenAI token usage:
  - Per request output cap: `max_output_tokens = 400`
  - Daily quota per chat scope: `5000` tokens (`usage.total_tokens`, reset at UTC 00:00)
  - If daily quota is reached, bot replies quota notice and skips OpenAI call
  - Project-level TPM/RPM should be configured in OpenAI project rate limit settings
- Single language behavior:
  - If only `1` language is configured and detected source language is different, bot replies translation to that configured language without prefix

### Test

```bash
pnpm test
```

Live translation check (real API call):

```bash
pnpm test:translation:live
```

Live translation check via Vitest:

```bash
pnpm test:translation:live:vitest
```

Notes:

- `scripts/test-translation-live.mjs` uses real OpenAI API requests (no mocking).
- `tests/translation-openai-live.test.ts` uses real OpenAI API requests (no mocking).
- Ensure `OPENAI_API_KEY` is available in your environment before running it.

### Typecheck

```bash
pnpm run typecheck
```
