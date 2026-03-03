import { describe, expect, it } from "vitest";
import type { Context } from "@netlify/functions";
import { messagingApi, type WebhookRequestBody } from "@line/bot-sdk";
import {
  createLineWebhookHandler,
  type LineReplyClient,
} from "../netlify/functions/line-webhook";

const TEST_CONTEXT = {} as Context;

const createRequest = (
  body: string,
  headers: Record<string, string | undefined>,
): Request => {
  const requestHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      requestHeaders.set(key, value);
    }
  }

  return new Request("http://localhost:8888/api/line/webhook", {
    method: "POST",
    headers: requestHeaders,
    body,
  });
};

const createTextPayload = (): WebhookRequestBody => ({
  destination: "U11111111111111111111111111111111",
  events: [
    {
      type: "message",
      mode: "active",
      timestamp: 1710000000000,
      source: {
        type: "user",
        userId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      webhookEventId: "01HQXYZABCDEFG1234567890",
      deliveryContext: {
        isRedelivery: false,
      },
      replyToken: "reply-token-1",
      message: {
        id: "msg-1",
        type: "text",
        text: "hello line",
      },
    },
  ],
});

const createImagePayload = (): WebhookRequestBody => ({
  destination: "U11111111111111111111111111111111",
  events: [
    {
      type: "message",
      mode: "active",
      timestamp: 1710000000001,
      source: {
        type: "user",
        userId: "Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      webhookEventId: "01HQXYZABCDEFG1234567891",
      deliveryContext: {
        isRedelivery: false,
      },
      replyToken: "reply-token-2",
      message: {
        id: "msg-2",
        type: "image",
        contentProvider: {
          type: "line",
        },
      },
    },
  ],
});

describe("line-webhook", () => {
  it("returns 200 and replies to text message when signature is valid", async () => {
    const recordedRequests: messagingApi.ReplyMessageRequest[] = [];
    const createClient = (): LineReplyClient => ({
      replyMessage: async (
        request: messagingApi.ReplyMessageRequest,
      ): Promise<messagingApi.ReplyMessageResponse> => {
        recordedRequests.push(request);
        return { sentMessages: [] };
      },
    });

    let receivedBody = "";
    let receivedSecret = "";
    let receivedSignature = "";

    const handler = createLineWebhookHandler({
      createClient,
      getEnvironment: () => ({
        channelSecret: "test-secret",
        channelAccessToken: "test-token",
      }),
      isValidSignature: (body, channelSecret, signature) => {
        receivedBody = body;
        receivedSecret = channelSecret;
        receivedSignature = signature;
        return true;
      },
    });

    const payload = createTextPayload();
    const body = JSON.stringify(payload);
    const response = await handler(
      createRequest(body, {
        "x-line-signature": "valid-signature",
      }),
      TEST_CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(receivedBody).toBe(body);
    expect(receivedSecret).toBe("test-secret");
    expect(receivedSignature).toBe("valid-signature");
    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0]).toEqual({
      replyToken: "reply-token-1",
      messages: [{ type: "text", text: "hello line" }],
    });
  });

  it("returns 401 when signature is invalid", async () => {
    const recordedRequests: messagingApi.ReplyMessageRequest[] = [];
    const createClient = (): LineReplyClient => ({
      replyMessage: async (
        request: messagingApi.ReplyMessageRequest,
      ): Promise<messagingApi.ReplyMessageResponse> => {
        recordedRequests.push(request);
        return { sentMessages: [] };
      },
    });

    const handler = createLineWebhookHandler({
      createClient,
      getEnvironment: () => ({
        channelSecret: "test-secret",
        channelAccessToken: "test-token",
      }),
      isValidSignature: () => false,
    });

    const response = await handler(
      createRequest(JSON.stringify(createTextPayload()), {
        "x-line-signature": "invalid-signature",
      }),
      TEST_CONTEXT,
    );

    expect(response.status).toBe(401);
    expect(recordedRequests).toHaveLength(0);
  });

  it("returns 400 when signature header is missing", async () => {
    let validatorCalled = false;
    const handler = createLineWebhookHandler({
      createClient: () => ({
        replyMessage: async (): Promise<messagingApi.ReplyMessageResponse> => ({
          sentMessages: [],
        }),
      }),
      getEnvironment: () => ({
        channelSecret: "test-secret",
        channelAccessToken: "test-token",
      }),
      isValidSignature: () => {
        validatorCalled = true;
        return true;
      },
    });

    const response = await handler(
      createRequest(JSON.stringify(createTextPayload()), {}),
      TEST_CONTEXT,
    );

    expect(response.status).toBe(400);
    expect(validatorCalled).toBe(false);
  });

  it("returns 200 and does not reply for non-text messages", async () => {
    const recordedRequests: messagingApi.ReplyMessageRequest[] = [];
    const handler = createLineWebhookHandler({
      createClient: () => ({
        replyMessage: async (
          request: messagingApi.ReplyMessageRequest,
        ): Promise<messagingApi.ReplyMessageResponse> => {
          recordedRequests.push(request);
          return { sentMessages: [] };
        },
      }),
      getEnvironment: () => ({
        channelSecret: "test-secret",
        channelAccessToken: "test-token",
      }),
      isValidSignature: () => true,
    });

    const response = await handler(
      createRequest(JSON.stringify(createImagePayload()), {
        "x-line-signature": "valid-signature",
      }),
      TEST_CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(recordedRequests).toHaveLength(0);
  });

  it("returns 400 for malformed webhook payload", async () => {
    const handler = createLineWebhookHandler({
      createClient: () => ({
        replyMessage: async (): Promise<messagingApi.ReplyMessageResponse> => ({
          sentMessages: [],
        }),
      }),
      getEnvironment: () => ({
        channelSecret: "test-secret",
        channelAccessToken: "test-token",
      }),
      isValidSignature: () => true,
    });

    const response = await handler(
      createRequest("{this-is-not-valid-json", {
        "x-line-signature": "valid-signature",
      }),
      TEST_CONTEXT,
    );

    expect(response.status).toBe(400);
  });
});
