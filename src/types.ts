// Public types for @getdial/chat-sdk-adapter.
// The event-envelope types mirror the wire shape Dial's webhook API emits.

import type { Logger } from "chat";

export interface DialAdapterOptions {
  apiKey?: string;
  fromNumberId?: string;
  webhookSecret?: string;
  apiBaseUrl?: string;
  botName?: string;
  logger?: Logger;
}

export interface ResolvedOptions {
  apiKey: string;
  fromNumberId: string;
  webhookSecret: string | null;
  apiBaseUrl: string;
  botName: string;
  logger: Logger;
}

export interface ThreadHandle {
  dialNumber: string;
  peerNumber: string;
}

export type DialChannel = "sms" | "imessage";

export type DialCallDirection = "inbound" | "outbound";

export interface DialMediaItem {
  id: string;
  url: string;
  contentType: string;
  originalUrl: string | null;
}

export interface DialInboundMessage {
  messageId: string;
  channel: DialChannel;
  from: string;
  to: string;
  body: string;
  media: DialMediaItem[];
  source: "external" | "internal";
  /**
   * On iMessage numbers, when the inbound message is a threaded reply or a
   * reaction targeting one of the account's messages: the targeted message's
   * Dial id. Optional so payloads from older Dial deployments still parse.
   */
  replyToId?: string | null;
  /**
   * On iMessage numbers, when the inbound message is a reaction (Tapback):
   * the reaction's emoji. `body` is empty for reactions.
   */
  reaction?: string | null;
}

export interface DialCallEnded {
  callId: string;
  from: string;
  to: string;
  direction: DialCallDirection;
  durationSeconds: number | null;
  status: string;
  canceled: boolean;
  transcriptAvailable: boolean;
}

export interface DialCallTranscribed {
  callId: string;
}

export interface DialEnvelope<TType extends string, TData> {
  id: string;
  object: "event";
  type: TType;
  version: 1;
  createdAt: string;
  relatedObject: { id: string; type: "call" | "message"; url: string | null } | null;
  data: TData;
}

export type DialWebhookEvent =
  | DialEnvelope<"message.received", DialInboundMessage>
  | DialEnvelope<"call.ended", DialCallEnded>
  | DialEnvelope<"call.transcribed", DialCallTranscribed>
  | DialEnvelope<"webhook.ping", Record<string, never>>;

// The provider-native raw shape Chat SDK carries on RawMessage<T>. A single
// discriminant `kind` distinguishes text messages from voice-message
// synthesizations — bots that care can branch on it, most won't.
export interface DialRaw {
  kind: "text" | "voice";
  messageId: string;
  channel: DialChannel | "voice";
  from: string;
  to: string;
  body: string;
  media: DialMediaItem[];
  direction: "inbound" | "outbound";
  createdAt: string;
  /** Dial id of the message this one replies to (threaded replies), if any. */
  replyToId?: string | null;
}
