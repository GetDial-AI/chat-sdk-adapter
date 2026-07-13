import { createHmac } from "node:crypto";
import type { ChatInstance, Logger } from "chat";
import { vi } from "vitest";
import type { DialRaw, DialWebhookEvent } from "../src/types";

export const TEST_SECRET = "whsec_unit-test";

export const testLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

export function makeChatDouble(): ChatInstance {
  return {
    getLogger: vi.fn().mockReturnValue(testLogger),
    getState: vi.fn(),
    getUserName: vi.fn().mockReturnValue("bot"),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processAction: vi.fn(),
    processModalClose: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processSlashCommand: vi.fn(),
    processAssistantThreadStarted: vi.fn(),
    processAssistantContextChanged: vi.fn(),
    processAppHomeOpened: vi.fn(),
    processMemberJoinedChannel: vi.fn(),
  } as unknown as ChatInstance;
}

export function signHeader(
  body: string,
  secret = TEST_SECRET,
  timestamp?: number,
): { header: string; timestamp: number } {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const hex = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { header: `t=${t},v1=${hex}`, timestamp: t };
}

export function signedRequest(event: DialWebhookEvent, secret = TEST_SECRET): Request {
  const body = JSON.stringify(event);
  const { header } = signHeader(body, secret);
  return new Request("https://example.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-dial-signature": header },
    body,
  });
}

// ── Event fixtures ─────────────────────────────────────────────────────

const DIAL_NUMBER = "+15559876543";
const PEER_NUMBER = "+15551234567";

export const smsInbound: DialWebhookEvent = {
  id: "evt_sms_1",
  object: "event",
  type: "message.received",
  version: 1,
  createdAt: "2026-07-02T09:00:00Z",
  relatedObject: { id: "msg_sms_1", type: "message", url: null },
  data: {
    messageId: "msg_sms_1",
    from: PEER_NUMBER,
    to: DIAL_NUMBER,
    channel: "sms",
    body: "hi from sms",
    media: [],
    source: "external",
  },
};

export const iMessageInbound: DialWebhookEvent = {
  id: "evt_im_1",
  object: "event",
  type: "message.received",
  version: 1,
  createdAt: "2026-07-02T09:01:00Z",
  relatedObject: { id: "msg_im_1", type: "message", url: null },
  data: {
    messageId: "msg_im_1",
    from: PEER_NUMBER,
    to: DIAL_NUMBER,
    channel: "imessage",
    body: "hi from imessage",
    media: [],
    source: "external",
  },
};

export const reactionInbound: DialWebhookEvent = {
  id: "evt_react_1",
  object: "event",
  type: "message.received",
  version: 1,
  createdAt: "2026-07-02T09:01:30Z",
  relatedObject: { id: "msg_react_1", type: "message", url: null },
  data: {
    messageId: "msg_react_1",
    from: PEER_NUMBER,
    to: DIAL_NUMBER,
    channel: "imessage",
    body: "",
    media: [],
    source: "external",
    replyToId: "msg_out_1",
    reaction: "❤️",
  },
};

export const threadedReplyInbound: DialWebhookEvent = {
  id: "evt_reply_1",
  object: "event",
  type: "message.received",
  version: 1,
  createdAt: "2026-07-02T09:01:45Z",
  relatedObject: { id: "msg_reply_1", type: "message", url: null },
  data: {
    messageId: "msg_reply_1",
    from: PEER_NUMBER,
    to: DIAL_NUMBER,
    channel: "imessage",
    body: "replying to your last message",
    media: [],
    source: "external",
    replyToId: "msg_out_1",
    reaction: null,
  },
};

export const mmsInbound: DialWebhookEvent = {
  id: "evt_mms_1",
  object: "event",
  type: "message.received",
  version: 1,
  createdAt: "2026-07-02T09:02:00Z",
  relatedObject: { id: "msg_mms_1", type: "message", url: null },
  data: {
    messageId: "msg_mms_1",
    from: PEER_NUMBER,
    to: DIAL_NUMBER,
    channel: "sms",
    body: "look at this",
    media: [
      {
        id: "media_1",
        url: "https://media.getdial.ai/media_1",
        contentType: "image/jpeg",
        originalUrl: null,
      },
    ],
    source: "external",
  },
};

export const callEndedNoTranscript: DialWebhookEvent = {
  id: "evt_call_end_1",
  object: "event",
  type: "call.ended",
  version: 1,
  createdAt: "2026-07-02T09:03:00Z",
  relatedObject: { id: "call_1", type: "call", url: "/api/v1/calls/call_1" },
  data: {
    callId: "call_1",
    from: PEER_NUMBER,
    to: DIAL_NUMBER,
    direction: "inbound",
    durationSeconds: 12,
    status: "completed",
    canceled: false,
    transcriptAvailable: false,
  },
};

export const callEndedTranscriptPending: DialWebhookEvent = {
  id: "evt_call_end_2",
  object: "event",
  type: "call.ended",
  version: 1,
  createdAt: "2026-07-02T09:03:00Z",
  relatedObject: { id: "call_2", type: "call", url: "/api/v1/calls/call_2" },
  data: {
    callId: "call_2",
    from: PEER_NUMBER,
    to: DIAL_NUMBER,
    direction: "inbound",
    durationSeconds: 45,
    status: "completed",
    canceled: false,
    transcriptAvailable: true,
  },
};

export const callEndedOutbound: DialWebhookEvent = {
  id: "evt_call_end_3",
  object: "event",
  type: "call.ended",
  version: 1,
  createdAt: "2026-07-02T09:10:00Z",
  relatedObject: { id: "call_3", type: "call", url: "/api/v1/calls/call_3" },
  data: {
    callId: "call_3",
    from: DIAL_NUMBER,
    to: PEER_NUMBER,
    direction: "outbound",
    durationSeconds: 20,
    status: "completed",
    canceled: false,
    transcriptAvailable: false,
  },
};

export const callTranscribed: DialWebhookEvent = {
  id: "evt_call_transcribed_1",
  object: "event",
  type: "call.transcribed",
  version: 1,
  createdAt: "2026-07-02T09:03:20Z",
  relatedObject: { id: "call_1", type: "call", url: "/api/v1/calls/call_1" },
  data: { callId: "call_1" },
};

export const pingEvent: DialWebhookEvent = {
  id: "evt_ping_1",
  object: "event",
  type: "webhook.ping",
  version: 1,
  createdAt: "2026-07-02T09:04:00Z",
  relatedObject: null,
  data: {},
};

// ── Raw-message fixtures (parseMessage tests) ──────────────────────────

export const rawInbound: DialRaw = {
  kind: "text",
  messageId: "msg_sms_1",
  channel: "sms",
  from: PEER_NUMBER,
  to: DIAL_NUMBER,
  body: "hi from sms",
  media: [],
  direction: "inbound",
  createdAt: "2026-07-02T09:00:00Z",
};

export const rawInboundWithImage: DialRaw = {
  ...rawInbound,
  messageId: "msg_mms_1",
  body: "look at this",
  media: [
    {
      id: "media_1",
      url: "https://media.getdial.ai/media_1",
      contentType: "image/jpeg",
      originalUrl: null,
    },
  ],
};

export const rawOutbound: DialRaw = {
  kind: "text",
  messageId: "msg_out_1",
  channel: "sms",
  from: DIAL_NUMBER,
  to: PEER_NUMBER,
  body: "bot said hi",
  media: [],
  direction: "outbound",
  createdAt: "2026-07-02T09:05:00Z",
};

export const NUMBERS = { dial: DIAL_NUMBER, peer: PEER_NUMBER } as const;
