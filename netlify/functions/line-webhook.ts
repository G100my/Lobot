import type { Config, Context } from "@netlify/functions";
import {
  messagingApi,
  validateSignature,
  type MessageEvent,
  type TextEventMessage,
  type WebhookEvent,
  type WebhookRequestBody,
} from "@line/bot-sdk";

export const config: Config = {
  path: "/api/line/webhook",
  method: "POST",
};

const SIGNATURE_HEADER_NAME = "x-line-signature";

interface Environment {
  channelSecret: string;
  channelAccessToken: string;
}

export type LineReplyClient = Pick<
  messagingApi.MessagingApiClient,
  "replyMessage"
>;

type LineWebhookDependencies = {
  createClient: (channelAccessToken: string) => LineReplyClient;
  getEnvironment: () => Environment | null;
  isValidSignature: (
    body: string,
    channelSecret: string,
    signature: string,
  ) => boolean;
};

const jsonResponse = (
  statusCode: number,
  body: Record<string, boolean | number | string>,
): Response =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });

const getEnvironmentVariable = (
  key: "LINE_CHANNEL_SECRET" | "LINE_CHANNEL_ACCESS_TOKEN",
): string | undefined => {
  if (typeof Netlify !== "undefined") {
    const value = Netlify.env.get(key);
    if (value) {
      return value;
    }
  }

  return process.env[key];
};

const getEnvironment = (): Environment | null => {
  const channelSecret = getEnvironmentVariable("LINE_CHANNEL_SECRET");
  const channelAccessToken = getEnvironmentVariable(
    "LINE_CHANNEL_ACCESS_TOKEN",
  );

  if (!channelSecret || !channelAccessToken) {
    return null;
  }

  return {
    channelSecret,
    channelAccessToken,
  };
};

const parseWebhookBody = (rawBody: string): WebhookRequestBody | null => {
  try {
    const body = JSON.parse(rawBody) as Partial<WebhookRequestBody>;

    if (typeof body.destination !== "string" || !Array.isArray(body.events)) {
      return null;
    }

    return body as WebhookRequestBody;
  } catch {
    return null;
  }
};

const isTextMessageEvent = (
  event: WebhookEvent,
): event is MessageEvent & { message: TextEventMessage } => {
  return event.type === "message" && event.message.type === "text";
};

const replyText = async (
  client: LineReplyClient,
  event: MessageEvent & { message: TextEventMessage },
): Promise<void> => {
  const message: messagingApi.TextMessage = {
    type: "text",
    text: event.message.text,
  };

  try {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [message],
    });
  } catch {
    console.error("[line-webhook] Failed to reply message.", {
      webhookEventId: event.webhookEventId,
    });
  }
};

export const createLineWebhookHandler = (
  overrides: Partial<LineWebhookDependencies> = {},
): ((request: Request, context: Context) => Promise<Response>) => {
  const dependencies: LineWebhookDependencies = {
    createClient: (channelAccessToken: string) =>
      new messagingApi.MessagingApiClient({ channelAccessToken }),
    getEnvironment,
    isValidSignature: validateSignature,
    ...overrides,
  };

  return async (request: Request, _context: Context): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse(405, {
        ok: false,
        error: "Method Not Allowed",
      });
    }

    const environment = dependencies.getEnvironment();
    if (environment === null) {
      console.error(
        "[line-webhook] Missing required LINE environment variables.",
      );
      return jsonResponse(500, {
        ok: false,
        error: "Server Misconfiguration",
      });
    }

    const rawBody = await request.text();
    if (rawBody.length === 0) {
      return jsonResponse(400, {
        ok: false,
        error: "Missing request body",
      });
    }

    const signature = request.headers.get(SIGNATURE_HEADER_NAME);
    if (signature === null) {
      return jsonResponse(400, {
        ok: false,
        error: "Missing x-line-signature header",
      });
    }

    const isValid = dependencies.isValidSignature(
      rawBody,
      environment.channelSecret,
      signature,
    );
    if (!isValid) {
      return jsonResponse(401, {
        ok: false,
        error: "Invalid signature",
      });
    }

    const webhookBody = parseWebhookBody(rawBody);
    if (webhookBody === null) {
      return jsonResponse(400, {
        ok: false,
        error: "Invalid webhook payload",
      });
    }

    const client = dependencies.createClient(environment.channelAccessToken);

    for (const webhookEvent of webhookBody.events) {
      if (!isTextMessageEvent(webhookEvent)) {
        continue;
      }

      if (webhookEvent.mode !== "active") {
        continue;
      }

      await replyText(client, webhookEvent);
    }

    return jsonResponse(200, { ok: true });
  };
};

const handler = createLineWebhookHandler();

export default handler;
