// Public surface of @getdial/chat-sdk-adapter.
// Anything not re-exported here is a private implementation detail.

import { DialAdapter } from "./dial-adapter";
import type { DialAdapterOptions } from "./types";

export { DialAdapter } from "./dial-adapter";
export { DialFormatConverter } from "./format";
export { ADAPTER_NAME, ADAPTER_VERSION, USER_AGENT } from "./identity";
export type {
  DialAdapterOptions,
  DialCallDirection,
  DialCallEnded,
  DialCallTranscribed,
  DialChannel,
  DialEnvelope,
  DialInboundMessage,
  DialMediaItem,
  DialRaw,
  DialWebhookEvent,
  ThreadHandle,
} from "./types";

/**
 * Convenience factory. Equivalent to `new DialAdapter(options)`.
 *
 * @example
 * ```typescript
 * import { Chat } from "chat";
 * import { createDialAdapter } from "@getdial/chat-sdk-adapter";
 *
 * const chat = new Chat({
 *   adapter: createDialAdapter(),
 *   onNewMention: async ({ message, reply }) => {
 *     await reply(`heard you: ${message.text}`);
 *   },
 * });
 * ```
 */
export function createDialAdapter(options?: DialAdapterOptions): DialAdapter {
  return new DialAdapter(options);
}
