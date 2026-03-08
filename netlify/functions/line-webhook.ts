import type { Config, Context } from '@netlify/functions'
import { messagingApi, validateSignature } from '@line/bot-sdk'
import type { MessageEvent, TextEventMessage, WebhookEvent, WebhookRequestBody } from '@line/bot-sdk'
import { resolveLineReplyText } from './line-webhook/handle-line-inbound-message'
import { GET_ENV, SIGNATURE_HEADER_NAME } from './line-webhook/constants'
import { createChatGptProvider } from './providers/ai/chatgpt/provider'
import { logErrorWithContext, type ThrownError } from './shared/error-logging'
import { jsonResponse } from './shared/http-response'

type TextMessageEvent = MessageEvent & { message: TextEventMessage }

// https://docs.netlify.com/build/functions/get-started/?data-tab=TypeScript#route-requests
export const config: Config = {
  path: '/api/line/webhook',
  method: 'POST',
}

const isTextMessageEvent = (event: WebhookEvent): event is TextMessageEvent =>
  event.type === 'message' && event.message.type === 'text'

const sendLineReply = async (
  client: messagingApi.MessagingApiClient,
  event: TextMessageEvent,
  replyText: string | null
): Promise<void> => {
  if (replyText === null) {
    return
  }

  const request: messagingApi.ReplyMessageRequest = {
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  }

  try {
    await client.replyMessage(request)
  } catch (error) {
    logErrorWithContext(
      '[line-webhook] Failed to reply message.',
      { webhookEventId: event.webhookEventId },
      error as ThrownError
    )
  }
}

const handler = async (request: Request, _context: Context): Promise<Response> => {
  // -- prepare and parse request --
  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method Not Allowed' })
  }

  let env: ReturnType<typeof GET_ENV>
  try {
    env = GET_ENV()
  } catch (error) {
    logErrorWithContext('[line-webhook] Failed to load environment variables.', {}, error as ThrownError)
    return jsonResponse(500, { ok: false, error: 'Server Misconfiguration' })
  }

  const rawBody = await request.text()
  if (rawBody.length === 0) {
    return jsonResponse(400, { ok: false, error: 'Missing request body' })
  }

  const signature = request.headers.get(SIGNATURE_HEADER_NAME)
  if (signature === null) {
    return jsonResponse(400, {
      ok: false,
      error: 'Missing x-line-signature header',
    })
  }

  const isValid = validateSignature(rawBody, env.channelSecret, signature)
  if (!isValid) {
    return jsonResponse(401, {
      ok: false,
      error: 'Invalid signature',
    })
  }

  let webhookBody: WebhookRequestBody | null = null
  try {
    const parsedBody = JSON.parse(rawBody) as Partial<WebhookRequestBody>
    if (typeof parsedBody.destination === 'string' && Array.isArray(parsedBody.events)) {
      webhookBody = parsedBody as WebhookRequestBody
    }
  } catch {
    webhookBody = null
  }
  if (webhookBody === null) {
    return jsonResponse(400, {
      ok: false,
      error: 'Invalid webhook payload',
    })
  }

  // -- translate and reply --

  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: env.channelAccessToken,
  })
  const aiProvider = createChatGptProvider({
    model: env.openaiModel,
    openaiApiKey: env.openaiApiKey,
    maxOutputTokens: env.openaiMaxOutputTokens,
  })

  for (const webhookEvent of webhookBody.events) {
    if (isTextMessageEvent(webhookEvent) && webhookEvent.mode === 'active') {
      const replyText = await resolveLineReplyText({
        event: webhookEvent,
        environment: env,
        aiProvider,
      })

      await sendLineReply(client, webhookEvent, replyText)
    }
  }

  return jsonResponse(200, { ok: true })
}

export default handler
