// Dial adapter — plugs a Dial phone number into a Chat SDK bot.
// Class body stays thin: config resolution, signature verification, and
// message formatting all live in their own modules and this class wires
// them into the Chat SDK Adapter contract.

import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  ValidationError,
} from "@chat-adapter/shared";
import { DialClient } from "@getdial/sdk";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChatInstance,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { Message, NotImplementedError } from "chat";
import { resolveOptions } from "./config";
import { DialFormatConverter } from "./format";
import { ADAPTER_NAME, ADAPTER_VERSION } from "./identity";
import { SIGNATURE_HEADER, verifyRequest } from "./signing";
import type {
  DialAdapterOptions,
  DialCallEnded,
  DialCallTranscribed,
  DialInboundMessage,
  DialMediaItem,
  DialRaw,
  DialWebhookEvent,
  ResolvedOptions,
  ThreadHandle,
} from "./types";

const NAMESPACE = "dial";
const OUTBOUND_BODY_CAP = 1600;
const THREAD_PREFIX = "dial";

export class DialAdapter implements Adapter<ThreadHandle, DialRaw> {
  readonly name = NAMESPACE;

  private readonly opts: ResolvedOptions;
  private readonly client: DialClient;
  private readonly formatter = new DialFormatConverter();
  private chat: ChatInstance | null = null;

  constructor(options: DialAdapterOptions = {}) {
    this.opts = resolveOptions(options);
    this.client = new DialClient({
      apiKey: this.opts.apiKey,
      baseUrl: this.opts.apiBaseUrl,
    });
  }

  get botUserId(): string {
    return this.opts.fromNumberId;
  }

  get userName(): string {
    return this.opts.botName;
  }

  private get logger(): Logger {
    return this.opts.logger;
  }

  // ── Chat SDK lifecycle ────────────────────────────────────────────────

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger.info("Dial adapter ready", {
      adapter: ADAPTER_NAME,
      version: ADAPTER_VERSION,
      fromNumberId: this.opts.fromNumberId,
    });
  }

  // ── Threading ─────────────────────────────────────────────────────────

  encodeThreadId(handle: ThreadHandle): string {
    return `${THREAD_PREFIX}:${handle.dialNumber}:${handle.peerNumber}`;
  }

  decodeThreadId(threadId: string): ThreadHandle {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== THREAD_PREFIX) {
      throw new ValidationError(
        NAMESPACE,
        `Unrecognized thread id: ${threadId}. Expected ${THREAD_PREFIX}:<from>:<peer>.`,
      );
    }
    return { dialNumber: parts[1] as string, peerNumber: parts[2] as string };
  }

  channelIdFromThreadId(threadId: string): string {
    return `${THREAD_PREFIX}:${this.decodeThreadId(threadId).dialNumber}`;
  }

  isDM(): boolean {
    return true;
  }

  async openDM(peerNumber: string): Promise<string> {
    return this.encodeThreadId({
      dialNumber: this.opts.fromNumberId,
      peerNumber,
    });
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const handle = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: `${THREAD_PREFIX}:${handle.dialNumber}`,
      isDM: true,
      metadata: {
        dialNumber: handle.dialNumber,
        peerNumber: handle.peerNumber,
      },
    };
  }

  // ── Message parsing (Chat SDK sync contract) ──────────────────────────

  parseMessage(raw: DialRaw): Message<DialRaw> {
    const isMe = raw.direction === "outbound";
    const authorNumber = isMe ? raw.to : raw.from;

    return new Message<DialRaw>({
      id: raw.messageId,
      threadId: this.encodeThreadId({
        dialNumber: isMe ? raw.from : raw.to,
        peerNumber: isMe ? raw.to : raw.from,
      }),
      text: raw.body,
      formatted: this.formatter.toAst(raw.body),
      raw,
      isMention: !isMe,
      author: {
        userId: authorNumber,
        userName: authorNumber,
        fullName: authorNumber,
        isBot: isMe,
        isMe,
      },
      metadata: {
        dateSent: new Date(raw.createdAt),
        edited: false,
      },
      attachments: raw.media.map(mediaToAttachment),
    });
  }

  // ── Outbound ──────────────────────────────────────────────────────────

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<{ id: string; threadId: string; raw: DialRaw }> {
    const { peerNumber } = this.decodeThreadId(threadId);
    const text = this.formatter.renderPostable(message).slice(0, OUTBOUND_BODY_CAP);
    const media = extractAttachmentUrls(message);

    let response: Awaited<ReturnType<DialClient["sendMessage"]>>;
    try {
      response = await this.client.sendMessage({
        to: peerNumber,
        fromNumberId: this.opts.fromNumberId,
        body: text,
        media: media.length > 0 ? media : undefined,
      });
    } catch (err) {
      throw translateSdkError(err);
    }

    const sent = response as unknown as {
      id: string;
      from: string;
      to: string;
      body: string;
      channel?: DialRaw["channel"];
      createdAt?: string;
      media?: DialMediaItem[];
    };

    return {
      id: sent.id,
      threadId,
      raw: {
        kind: "text",
        messageId: sent.id,
        channel: sent.channel ?? "sms",
        from: sent.from,
        to: sent.to,
        body: sent.body,
        media: sent.media ?? [],
        direction: "outbound",
        createdAt: sent.createdAt ?? new Date().toISOString(),
      },
    };
  }

  // ── Inbound webhook ───────────────────────────────────────────────────

  async handleWebhook(
    request: Request,
    options?: WebhookOptions,
  ): Promise<Response> {
    const rawBody = await request.text();

    if (this.opts.webhookSecret) {
      const verdict = verifyRequest(
        request.headers.get(SIGNATURE_HEADER),
        this.opts.webhookSecret,
        rawBody,
        Math.floor(Date.now() / 1000),
      );
      if (!verdict.ok) {
        return textResponse(401, `signature ${verdict.reason}`);
      }
    }

    let event: DialWebhookEvent;
    try {
      event = JSON.parse(rawBody) as DialWebhookEvent;
    } catch {
      return textResponse(400, "invalid JSON body");
    }

    if (!isEnvelope(event)) {
      return textResponse(400, "missing event type");
    }

    if (!this.chat) {
      this.logger.error("Received webhook before initialize() was called");
      return textResponse(500, "adapter not initialized");
    }

    switch (event.type) {
      case "message.received":
        return this.onMessageReceived(event.data, event.createdAt, options);
      case "call.ended":
        return this.onCallEnded(event.data, event.createdAt, options);
      case "call.transcribed":
        return this.onCallTranscribed(event.data, event.createdAt, options);
      case "webhook.ping":
        return textResponse(200, "pong");
      default: {
        // Unknown event type — ignored, so a Dial-side addition doesn't 500
        // integrators before they upgrade.
        this.logger.debug("Ignoring unknown Dial event", {
          type: (event as { type?: string }).type,
        });
        return textResponse(200, "ignored");
      }
    }
  }

  private onMessageReceived(
    data: DialInboundMessage,
    createdAt: string,
    options?: WebhookOptions,
  ): Response {
    const raw: DialRaw = {
      kind: "text",
      messageId: data.messageId,
      channel: data.channel,
      from: data.from,
      to: data.to,
      body: data.body,
      media: data.media,
      direction: "inbound",
      createdAt,
    };
    this.pushToChat(raw, options);
    return textResponse(200, "ok");
  }

  private onCallEnded(
    data: DialCallEnded,
    _createdAt: string,
    _options?: WebhookOptions,
  ): Response {
    // The adapter surfaces INBOUND voice only — outbound-call initiation is not
    // reachable through Chat SDK's Adapter interface, so we drop outbound events
    // rather than forward transcripts the bot has no way to have caused.
    if (data.direction !== "inbound") {
      this.logger.debug("Ignoring outbound call.ended", { callId: data.callId });
      return textResponse(200, "ignored (outbound)");
    }

    // Voice calls surface to the bot ONLY as their transcript via the subsequent
    // `call.transcribed` event. Firing a placeholder here would (a) push an
    // empty "a call happened" message the bot has no useful reply to, and (b)
    // hold Chat SDK's per-thread lock through the reply, so a `call.transcribed`
    // that races in during that window would be dropped by the lock — we saw
    // this in E2E testing. Log and swallow; if no transcript ever materializes
    // (very short call, etc.) the bot simply doesn't hear about the call, which
    // matches how Chat SDK bots think ("messages, not signals").
    this.logger.debug("call.ended (inbound): swallowed; awaiting call.transcribed", {
      callId: data.callId,
      durationSeconds: data.durationSeconds,
      status: data.status,
      canceled: data.canceled,
    });
    return textResponse(200, "ok");
  }

  private async onCallTranscribed(
    data: DialCallTranscribed,
    createdAt: string,
    options?: WebhookOptions,
  ): Promise<Response> {
    let call: {
      id: string;
      from: string;
      to: string;
      direction: string;
      transcript?: string | null;
    };
    try {
      call = (await this.client.getCall(data.callId)) as typeof call;
    } catch (err) {
      this.logger.warn("Could not fetch transcript on call.transcribed", {
        callId: data.callId,
        error: err instanceof Error ? err.message : String(err),
      });
      return textResponse(200, "transcript fetch failed");
    }

    // Drop outbound-direction calls for the same reason as call.ended — the
    // adapter has no primitive for the bot to have initiated an outbound call,
    // so its transcript is not part of the adapter's surface.
    if (call.direction !== "inbound") {
      this.logger.debug("Ignoring outbound call.transcribed", { callId: data.callId });
      return textResponse(200, "ignored (outbound)");
    }

    const body = call.transcript
      ? `[Voice call transcript — inbound]\n${call.transcript}`
      : `[Voice call transcript — inbound] (empty)`;

    this.pushToChat(
      {
        kind: "voice",
        messageId: `${data.callId}:transcript`,
        channel: "voice",
        from: call.from,
        to: call.to,
        body,
        media: [],
        direction: "inbound",
        createdAt,
      },
      options,
    );
    return textResponse(200, "ok");
  }

  private pushToChat(raw: DialRaw, options?: WebhookOptions): void {
    const chat = this.chat;
    if (!chat) return;
    const threadId = this.encodeThreadId(
      raw.direction === "inbound"
        ? { dialNumber: raw.to, peerNumber: raw.from }
        : { dialNumber: raw.from, peerNumber: raw.to },
    );
    chat.processMessage(this, threadId, this.parseMessage(raw), options);
  }

  // ── Chat SDK optional / unsupported ───────────────────────────────────

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<DialRaw>> {
    // Dial exposes GET /api/v1/messages with a `since` filter, but Chat SDK's
    // cursor-shaped FetchOptions doesn't line up with it cleanly yet. Bots
    // still receive live inbound messages via the webhook — this only affects
    // history backfill, which we'll wire once the mapping is settled.
    return { messages: [] };
  }

  async startTyping(): Promise<void> {
    // No typing indicator exists on SMS / iMessage / voice; the method is
    // required by the interface but has nothing to do.
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatter.fromAst(content);
  }

  async editMessage(): Promise<never> {
    throw new NotImplementedError(NAMESPACE, "editMessage");
  }

  async deleteMessage(): Promise<never> {
    throw new NotImplementedError(NAMESPACE, "deleteMessage");
  }

  async addReaction(): Promise<never> {
    throw new NotImplementedError(NAMESPACE, "addReaction");
  }

  async removeReaction(): Promise<never> {
    throw new NotImplementedError(NAMESPACE, "removeReaction");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function isEnvelope(event: unknown): event is DialWebhookEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    typeof (event as { type?: unknown }).type === "string"
  );
}

function mediaToAttachment(item: DialMediaItem): Attachment {
  const type = attachmentTypeFor(item.contentType);
  return { type, url: item.url };
}

function attachmentTypeFor(contentType: string): Attachment["type"] {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "file";
}

function extractAttachmentUrls(message: AdapterPostableMessage): string[] {
  if (typeof message !== "object" || message === null) return [];
  const withAttachments = message as { attachments?: Attachment[] };
  if (!withAttachments.attachments) return [];
  const urls: string[] = [];
  for (const a of withAttachments.attachments) {
    if (a.url) urls.push(a.url);
  }
  return urls;
}

function translateSdkError(err: unknown): Error {
  if (err instanceof Error && err.message.startsWith("Dial API error ")) {
    const status = Number.parseInt(
      /Dial API error (\d+):/.exec(err.message)?.[1] ?? "0",
      10,
    );
    if (status === 429) return new AdapterRateLimitError(NAMESPACE);
    if (status === 401 || status === 403) {
      return new AuthenticationError(NAMESPACE, err.message);
    }
    return new NetworkError(NAMESPACE, err.message);
  }
  return err instanceof Error ? err : new Error(String(err));
}
