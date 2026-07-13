import { getEmoji } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DialAdapter } from "../src/dial-adapter";
import {
  makeChatDouble,
  NUMBERS,
  reactionInbound,
  signedRequest,
  TEST_SECRET,
  threadedReplyInbound,
} from "./fixtures";

const OPTIONS = {
  apiKey: "sk_live_test",
  fromNumberId: "pn_test",
  webhookSecret: TEST_SECRET,
};

const THREAD_ID = `dial:${NUMBERS.dial}:${NUMBERS.peer}`;

describe("DialAdapter — reactions out", () => {
  let adapter: DialAdapter;

  beforeEach(async () => {
    adapter = new DialAdapter(OPTIONS);
    await adapter.initialize(makeChatDouble());
  });

  it("addReaction sends the emoji through the reply endpoint", async () => {
    const reply = vi.fn().mockResolvedValue({ id: "msg_react_out" });
    (adapter as unknown as { client: { replyToMessage: unknown } }).client.replyToMessage = reply;

    await adapter.addReaction(THREAD_ID, "msg_in_1", "👍");

    expect(reply).toHaveBeenCalledWith("msg_in_1", { reaction: "👍" });
  });

  it("addReaction converts a normalized EmojiValue to its unicode emoji", async () => {
    const reply = vi.fn().mockResolvedValue({ id: "msg_react_out" });
    (adapter as unknown as { client: { replyToMessage: unknown } }).client.replyToMessage = reply;

    await adapter.addReaction(THREAD_ID, "msg_in_1", getEmoji("thumbs_up"));

    expect(reply).toHaveBeenCalledWith("msg_in_1", { reaction: "👍" });
  });
});

describe("DialAdapter — typing", () => {
  it("startTyping shows the indicator to the thread's peer", async () => {
    const adapter = new DialAdapter(OPTIONS);
    await adapter.initialize(makeChatDouble());
    const start = vi.fn().mockResolvedValue(undefined);
    (adapter as unknown as { client: { startTyping: unknown } }).client.startTyping = start;

    await adapter.startTyping(THREAD_ID);

    expect(start).toHaveBeenCalledWith({
      toNumber: NUMBERS.peer,
      fromNumber: NUMBERS.dial,
    });
  });
});

describe("DialAdapter — inbound reactions and replies", () => {
  let adapter: DialAdapter;
  let chat: ReturnType<typeof makeChatDouble>;

  beforeEach(async () => {
    adapter = new DialAdapter(OPTIONS);
    chat = makeChatDouble();
    await adapter.initialize(chat);
  });

  it("routes an inbound reaction to processReaction, not processMessage", async () => {
    const res = await adapter.handleWebhook(signedRequest(reactionInbound));

    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(chat.processReaction).toHaveBeenCalledTimes(1);
    const [event] = (chat.processReaction as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0] as [Record<string, unknown>];
    expect(event).toMatchObject({
      added: true,
      rawEmoji: "❤️",
      messageId: "msg_out_1",
      threadId: THREAD_ID,
    });
  });

  it("keeps the reply target on parsed threaded replies", async () => {
    await adapter.handleWebhook(signedRequest(threadedReplyInbound));

    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const args = (chat.processMessage as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    const message = args?.[2] as { raw: { replyToId?: string | null } };
    expect(message.raw.replyToId).toBe("msg_out_1");
  });
});

describe("DialAdapter — channel info", () => {
  it("fetchChannelInfo resolves the Dial-owned number", async () => {
    const adapter = new DialAdapter(OPTIONS);
    await adapter.initialize(makeChatDouble());
    (adapter as unknown as { client: { listNumbers: unknown } }).client.listNumbers = vi
      .fn()
      .mockResolvedValue([
        { id: "pn_test", number: NUMBERS.dial, nickname: "Support line" },
        { id: "pn_other", number: "+15550000000", nickname: null },
      ]);

    const info = await adapter.fetchChannelInfo(`dial:${NUMBERS.dial}`);

    expect(info).toMatchObject({
      id: `dial:${NUMBERS.dial}`,
      name: "Support line",
      isDM: true,
    });
  });
});

describe("DialAdapter — message history", () => {
  it("fetchMessages returns the thread's messages in chronological order", async () => {
    const adapter = new DialAdapter(OPTIONS);
    await adapter.initialize(makeChatDouble());
    const row = (id: string, from: string, to: string, createdAt: string, body: string) => ({
      id,
      from,
      to,
      body,
      channel: "sms",
      direction: from === NUMBERS.dial ? "outbound" : "inbound",
      createdAt,
      media: [],
    });
    (adapter as unknown as { client: { listMessages: unknown } }).client.listMessages = vi
      .fn()
      .mockResolvedValue([
        row("msg_3", NUMBERS.peer, NUMBERS.dial, "2026-07-02T09:02:00Z", "newest"),
        row("msg_x", "+15550000000", NUMBERS.dial, "2026-07-02T09:01:30Z", "other peer"),
        row("msg_2", NUMBERS.dial, NUMBERS.peer, "2026-07-02T09:01:00Z", "middle"),
        row("msg_1", NUMBERS.peer, NUMBERS.dial, "2026-07-02T09:00:00Z", "oldest"),
      ]);

    const result = await adapter.fetchMessages(THREAD_ID, { limit: 10 });

    expect(result.messages.map((m) => m.id)).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(result.messages[0]?.text).toBe("oldest");
  });

  it("fetchMessages respects the limit, keeping the most recent", async () => {
    const adapter = new DialAdapter(OPTIONS);
    await adapter.initialize(makeChatDouble());
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `msg_${5 - i}`,
      from: NUMBERS.peer,
      to: NUMBERS.dial,
      body: `m${5 - i}`,
      channel: "sms",
      direction: "inbound",
      createdAt: `2026-07-02T09:0${5 - i}:00Z`,
      media: [],
    }));
    (adapter as unknown as { client: { listMessages: unknown } }).client.listMessages = vi
      .fn()
      .mockResolvedValue(rows);

    const result = await adapter.fetchMessages(THREAD_ID, { limit: 2 });

    expect(result.messages.map((m) => m.id)).toEqual(["msg_4", "msg_5"]);
  });
});
