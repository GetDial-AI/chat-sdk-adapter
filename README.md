# @getdial/chat-sdk-adapter

Wire a real phone number into your Chat SDK bot. The same `onNewMention` handler that answers Slack, Teams, or Discord now answers SMS, MMS, iMessage, and inbound voice calls too — with replies sent back over the phone through Dial.

```bash
npm install @getdial/chat-sdk-adapter chat
```

```typescript
import { Chat } from "chat";
import { createDialAdapter } from "@getdial/chat-sdk-adapter";

const chat = new Chat({
  adapter: createDialAdapter(),  // reads DIAL_* env vars; overridable — see Options
  onNewMention: async ({ message, reply }) => {
    await reply(`heard you: ${message.text}`);
  },
});

// Bind to whatever HTTP framework you use:
app.post("/webhook/dial", (req) => chat.webhooks.dial(req));
```

Get a Dial API key and a phone number ID from https://getdial.ai. Point that number's webhook subscription at the endpoint above.

## What the adapter carries

| Direction | Channel      | Text | Media |
|-----------|--------------|------|-------|
| Inbound   | SMS          | ✅   | —     |
| Inbound   | MMS          | ✅   | ✅ (image / video / audio / file) |
| Inbound   | iMessage     | ✅   | ✅   |
| Inbound   | Voice call   | ✅ (as transcript) | — |
| Outbound  | SMS / MMS / iMessage | ✅   | ✅ (via attachment URLs) |

**Only inbound voice calls surface as chat messages.** Chat SDK's Adapter interface has no primitive for a bot to *initiate* a phone call, so outbound-direction call events (calls placed via Dial's dashboard or REST API from the bot's number) are ignored — no `postMessage` variant fires them, and their transcripts are dropped rather than injected into the message stream. Inbound calls: when a completed call has a transcript, the adapter fetches it and forwards the text through `onNewMention`. Calls without a transcript surface a compact `[Voice call]` marker.

## Configuration

`createDialAdapter(config?)` reads the environment when a field is omitted. Explicit values always win.

| Field           | Env var                | Required | What it is |
|-----------------|------------------------|:--------:|------------|
| `apiKey`        | `DIAL_API_KEY`         | ✅       | Dial API key (`sk_live_…`) minted from the dashboard. |
| `fromNumberId`  | `DIAL_FROM_NUMBER_ID`  | ✅       | Dial's ID of the phone number the bot should send **from**. |
| `webhookSecret` | `DIAL_WEBHOOK_SECRET`  | ✅ in prod | Signing secret Dial issued when the webhook subscription was created. When set, incoming requests are verified against `X-Dial-Signature`; when unset, verification is skipped (dev only). |
| `apiBaseUrl`    | `DIAL_API_URL`         |          | Overrides the Dial API host. Defaults to `https://api.getdial.ai`. |
| `botName`       | `BOT_USERNAME`         |          | Display name Chat SDK uses for the bot. Defaults to `"bot"`. |
| `logger`        | —                      |          | Chat SDK `Logger` instance. Defaults to `ConsoleLogger("info").child("dial")`. |

## Webhook events

Point the Dial webhook subscription at the endpoint you handed to `chat.webhooks.dial`. Four event types are recognized (envelope shape mirrors Dial's own emitter):

| Event                | Response |
|----------------------|----------|
| `message.received`   | Forwarded to the bot as a chat message. Media items become Chat SDK attachments (image / video / audio / file, keyed off `contentType`). |
| `call.ended` (inbound) | If a transcript is coming (`transcriptAvailable: true`), the event is swallowed and `call.transcribed` delivers the content shortly after. Otherwise a compact `[Voice call]` marker is forwarded. |
| `call.ended` (outbound) | Dropped — 200 OK, not forwarded. Adapter surface is inbound-only. |
| `call.transcribed`   | Fetches the call via `@getdial/sdk.getCall()`. Forwarded as a voice message only when `direction === "inbound"`. |
| `webhook.ping`       | `200 OK`. Not forwarded — this is Dial's dashboard "test delivery" button. |

Anything else is answered `200 OK` and ignored, so a future Dial event type doesn't break integrations before they upgrade.

### Signature verification

When `webhookSecret` is set, every request must carry:

```
X-Dial-Signature: t=<unix_seconds>,v1=<hex-hmac-sha256(secret, `${t}.${rawBody}`)>
```

Rejection cases (all `401`):

| Verdict     | When |
|-------------|------|
| `missing`   | No `X-Dial-Signature` header on the request. |
| `malformed` | Header lacks `t=` or `v1=`, or `t=` is not a number. |
| `stale`     | `abs(now - t)` exceeds 5 minutes. Replay protection. |
| `mismatch`  | Recomputed HMAC doesn't equal `v1`, or lengths differ. Constant-time compare. |

Structurally invalid JSON, or an envelope with no `type`, returns `400`.

## Threads

A thread here is a **pair of phone numbers** — your Dial-owned number and the peer's:

```
dial:{yourDialNumber}:{peerNumber}
```

Every distinct pair is a distinct thread. Chat SDK's per-thread state (conversation history, context) is scoped per-pair, so simultaneous conversations don't leak into each other.

## Design notes

- **`@getdial/sdk` under the hood.** Outbound sends and transcript fetches go through the official Node SDK; no hand-rolled HTTP.
- **Node's `crypto` for signing.** `createHmac` + `timingSafeEqual`, matching the exact primitive Dial's server signs with.
- **Package is ESM-only, TypeScript-first.** Requires Node 18+.
- **No business logic in the adapter.** It's a transport shim — your bot logic lives entirely in the Chat SDK handlers.

## Links

- Dial: [getdial.ai](https://getdial.ai) · [docs](https://docs.getdial.ai)
- Chat SDK: [chat-sdk.dev](https://chat-sdk.dev)
