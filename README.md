# Lobot

## LINE Webhook on Netlify

### Environment variables

Copy `.env` values into your Netlify environment variables:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

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
- Replies with echo text

### Test

```bash
pnpm vitest run tests/line-webhook.test.ts
```
