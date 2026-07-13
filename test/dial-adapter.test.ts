import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialAdapter } from "../src/dial-adapter";
import {
  callEndedNoTranscript,
  callEndedOutbound,
  callEndedTranscriptPending,
  callTranscribed,
  iMessageInbound,
  makeChatDouble,
  mmsInbound,
  NUMBERS,
  pingEvent,
  rawInbound,
  rawInboundWithImage,
  rawOutbound,
  signedRequest,
  smsInbound,
  TEST_SECRET,
} from "./fixtures";

const OPTIONS = {
  apiKey: "sk_live_test",
  fromNumberId: "pn_test",
  webhookSecret: TEST_SECRET,
};

describe("DialAdapter — construction", () => {
  afterEach(() => {
    delete process.env.DIAL_API_KEY;
    delete process.env.DIAL_FROM_NUMBER_ID;
    delete process.env.DIAL_WEBHOOK_SECRET;
  });

  it("errors when apiKey is missing", () => {
    expect(() => new DialAdapter({ fromNumberId: "pn_x" })).toThrow(/apiKey/);
  });

  it("errors when fromNumberId is missing", () => {
    expect(() => new DialAdapter({ apiKey: "sk_x" })).toThrow(/fromNumberId/);
  });

  it("falls back to env vars when no options are passed", () => {
    process.env.DIAL_API_KEY = "sk_env";
    process.env.DIAL_FROM_NUMBER_ID = "pn_env";
    const adapter = new DialAdapter();
    expect(adapter.name).toBe("dial");
    expect(adapter.botUserId).toBe("pn_env");
  });

  it("prefers options over env vars", () => {
    process.env.DIAL_API_KEY = "sk_env";
    process.env.DIAL_FROM_NUMBER_ID = "pn_env";
    expect(new DialAdapter(OPTIONS).botUserId).toBe("pn_test");
  });
});

describe("DialAdapter — threading", () => {
  const adapter = new DialAdapter(OPTIONS);

  it("round-trips a thread handle", () => {
    const encoded = adapter.encodeThreadId({
      dialNumber: NUMBERS.dial,
      peerNumber: NUMBERS.peer,
    });
    expect(encoded).toBe(`dial:${NUMBERS.dial}:${NUMBERS.peer}`);
    expect(adapter.decodeThreadId(encoded)).toEqual({
      dialNumber: NUMBERS.dial,
      peerNumber: NUMBERS.peer,
    });
  });

  it("rejects thread ids that don't match the shape", () => {
    expect(() => adapter.decodeThreadId("bad")).toThrow(/thread id/i);
    expect(() => adapter.decodeThreadId("slack:C123:U456")).toThrow(/thread id/i);
  });

  it("channelIdFromThreadId picks off the Dial-owned number", () => {
    const id = adapter.encodeThreadId({
      dialNumber: NUMBERS.dial,
      peerNumber: NUMBERS.peer,
    });
    expect(adapter.channelIdFromThreadId(id)).toBe(`dial:${NUMBERS.dial}`);
  });

  it("openDM anchors on the configured fromNumberId", async () => {
    const id = await adapter.openDM(NUMBERS.peer);
    expect(id).toBe(`dial:pn_test:${NUMBERS.peer}`);
  });
});

describe("DialAdapter — parseMessage", () => {
  const adapter = new DialAdapter(OPTIONS);

  it("marks inbound as isMention with isMe=false", () => {
    const message = adapter.parseMessage(rawInbound);
    expect(message.text).toBe("hi from sms");
    expect(message.author.isMe).toBe(false);
    expect(message.author.isBot).toBe(false);
    expect(message.isMention).toBe(true);
    expect(message.threadId).toBe(`dial:${NUMBERS.dial}:${NUMBERS.peer}`);
  });

  it("promotes MMS media items to image attachments", () => {
    const message = adapter.parseMessage(rawInboundWithImage);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]?.type).toBe("image");
    expect(message.attachments[0]?.url).toBe("https://media.getdial.ai/media_1");
  });

  it("marks outbound as bot/self", () => {
    const message = adapter.parseMessage(rawOutbound);
    expect(message.author.isMe).toBe(true);
    expect(message.author.isBot).toBe(true);
    expect(message.isMention).toBe(false);
  });
});

describe("DialAdapter — webhook signature", () => {
  let adapter: DialAdapter;

  beforeEach(async () => {
    adapter = new DialAdapter(OPTIONS);
    await adapter.initialize(makeChatDouble());
  });

  it("rejects an unsigned request", async () => {
    const res = await adapter.handleWebhook(
      new Request("https://x/webhook", {
        method: "POST",
        body: JSON.stringify(smsInbound),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a mangled signature header", async () => {
    const res = await adapter.handleWebhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-dial-signature": "not-a-real-scheme" },
        body: JSON.stringify(smsInbound),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a properly signed request", async () => {
    const res = await adapter.handleWebhook(signedRequest(smsInbound));
    expect(res.status).toBe(200);
  });

  it("bypasses verification when no webhookSecret is set", async () => {
    const open = new DialAdapter({ apiKey: "sk", fromNumberId: "pn" });
    await open.initialize(makeChatDouble());
    const res = await open.handleWebhook(
      new Request("https://x/webhook", {
        method: "POST",
        body: JSON.stringify(smsInbound),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("DialAdapter — webhook routing", () => {
  let adapter: DialAdapter;
  let chat: ReturnType<typeof makeChatDouble>;

  beforeEach(async () => {
    adapter = new DialAdapter(OPTIONS);
    chat = makeChatDouble();
    await adapter.initialize(chat);
  });

  it("forwards SMS to processMessage", async () => {
    await adapter.handleWebhook(signedRequest(smsInbound));
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
  });

  it("forwards iMessage to processMessage", async () => {
    await adapter.handleWebhook(signedRequest(iMessageInbound));
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
  });

  it("forwards MMS with attachments", async () => {
    await adapter.handleWebhook(signedRequest(mmsInbound));
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const args = (chat.processMessage as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    const message = args?.[2] as { attachments: { type: string }[] };
    expect(message.attachments[0]?.type).toBe("image");
  });

  it("swallows every inbound call.ended (bot only sees the transcript)", async () => {
    // Voice calls surface to the bot only via call.transcribed. call.ended is
    // logged but never pushed to processMessage — firing a placeholder here
    // would hold the Chat SDK thread lock and cause the actual transcript
    // (delivered ~1s later) to be dropped as a lock conflict.
    const withTranscript = await adapter.handleWebhook(signedRequest(callEndedTranscriptPending));
    expect(withTranscript.status).toBe(200);
    const withoutTranscript = await adapter.handleWebhook(signedRequest(callEndedNoTranscript));
    expect(withoutTranscript.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("fetches the transcript on call.transcribed and forwards it", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: private client override in tests.
    (adapter as any).client.getCall = vi.fn().mockResolvedValue({
      id: "call_1",
      from: NUMBERS.peer,
      to: NUMBERS.dial,
      direction: "inbound",
      transcript: "caller: hi\nagent: hello",
    });
    await adapter.handleWebhook(signedRequest(callTranscribed));
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const args = (chat.processMessage as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    const message = args?.[2] as { text: string };
    expect(message.text).toContain("Voice call transcript");
    expect(message.text).toContain("caller: hi");
  });

  it("drops call.ended with direction=outbound (adapter is inbound-only)", async () => {
    const res = await adapter.handleWebhook(signedRequest(callEndedOutbound));
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("drops call.transcribed when the fetched call is outbound", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: private client override in tests.
    (adapter as any).client.getCall = vi.fn().mockResolvedValue({
      id: "call_1",
      from: NUMBERS.dial,
      to: NUMBERS.peer,
      direction: "outbound",
      transcript: "agent: hi\ncallee: hello",
    });
    const res = await adapter.handleWebhook(signedRequest(callTranscribed));
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("does not forward webhook.ping to the bot", async () => {
    await adapter.handleWebhook(signedRequest(pingEvent));
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    const body = "not-json";
    const { header } = await import("./fixtures").then((m) =>
      m.signHeader(body),
    );
    const res = await adapter.handleWebhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-dial-signature": header },
        body,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the envelope is missing a type", async () => {
    const body = JSON.stringify({ hello: "world" });
    const { header } = await import("./fixtures").then((m) =>
      m.signHeader(body),
    );
    const res = await adapter.handleWebhook(
      new Request("https://x/webhook", {
        method: "POST",
        headers: { "x-dial-signature": header },
        body,
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("DialAdapter — unsupported operations", () => {
  const adapter = new DialAdapter(OPTIONS);

  it("editMessage throws", async () => {
    await expect(adapter.editMessage()).rejects.toThrow();
  });

  it("deleteMessage throws", async () => {
    await expect(adapter.deleteMessage()).rejects.toThrow();
  });

  it("removeReaction throws", async () => {
    await expect(adapter.removeReaction()).rejects.toThrow();
  });
});
