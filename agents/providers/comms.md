# Comms providers: bi-directional chat apps

The `comms` domain gives chat apps (Slack, Telegram, Discord, Matrix, LINE) dual functionality
next to their `social` posting role: (1) **agent chat** — a linked org user DMs the bot and the
`postmill` Mastra agent replies in the same conversation — and (2) **notification delivery** —
`NotificationService.notify()`'s 4th bucket DMs selected categories to linked users. Read
[`overview.md`](./overview.md) first for the kernel contracts.

## Data model (two tables)

- **`CommsProviderConfig`** — one row per org per provider. Org-level bot/app credentials
  (encrypted JSON via `EncryptionService`), a unique `webhookToken` (CSPRNG, the routing segment
  of the inbound webhook URL, minted once and never rotated in place — delete + recreate
  rotates), non-secret `extraConfig` (Slack `teamId`, `webhookRegistered` flag, last
  `webhookError`), and `syncCursor` for poll-inbound providers (Matrix).
- **`CommsUserLink`** — one row per (config, org user). Created `pending` with a one-time
  `connectCode` (8 chars, 15-min TTL, unambiguous alphabet); the user DMs the bot the code and
  the claim (atomic guarded `updateMany`) flips it to `linked`, storing `externalUserId` /
  `externalChannelId` (DM channel / Matrix room, reused on sends). Carries `agentChatEnabled`
  and `categories` (JSON `Record<NotificationCategory, boolean>` — the **sole** gate for comms
  notification delivery; `NotificationPreference` deliberately plays no part).

Services live in the `@Global()` **`CommsModule`**
(`libraries/nestjs-libraries/src/comms/`): config/link repositories + services,
`CommsDeliveryService` (notify() bucket), `CommsInboundService` (webhook/poll processing),
`CommsAgentActivity` (headless agent turn).

## Capability contract

`libraries/providers/kernel/src/domains/comms.ts`. Only **`sendDirectMessage`** is
conformance-required; everything else is optional and declared via `CommsAdapterCapabilities`:

| Provider | Outbound | Inbound | Quirks |
|---|---|---|---|
| slack | `conversations.open` + `chat.postMessage` | Events API webhook (HMAC `v0:{ts}:{body}` vs `x-slack-signature`, 5-min skew guard); `url_verification` → `ackResponse` | Needs scopes `chat:write`, `im:write`, `im:history` + event `message.im` |
| telegram | Bot API `sendMessage` via `ctx.fetch` (**never** `node-telegram-bot-api` — it bypasses safeFetch) | Webhook; `X-Telegram-Bot-Api-Secret-Token` equality; `registerWebhook` = `setWebhook` with an internally-generated `webhookSecret` stored inside the encrypted credentials | |
| discord | DM channel (`/users/@me/channels`) + channel message | Interactions endpoint (ed25519); PING → `ackResponse {"type":1}`; the `/postmill` slash command → message **with a type-4 ephemeral `ackResponse`** (interactions demand a response body in 3s; the real reply arrives as a DM); `provision()` upserts the command via POST (never PUT — PUT replaces the app's whole command set) | |
| matrix | direct room (created `is_direct` on first send, then reused via `externalChannelId`) | **No webhook** — `pollInbound(cursor)` = `/sync` long-poll driven by the `comms-matrix-sync` Inngest cron; **null cursor = priming sync** (store `next_batch`, drop events — never replay history) | Drop own-user events (`/whoami`) |
| line | `POST /v2/bot/message/push` (1:1 — **not** the social adapter's broadcast) | Webhook; `X-Line-Signature` base64 HMAC of the raw body | User must friend the bot first |

All signature/secret checks use `timingSafeStringEqual` /
`hmacSha256Hex`/`hmacSha256Base64` from `kernel/src/domains/comms-verify.ts`. All HTTP through
`ctx.fetch` (safeFetch port). `parseInbound` must drop the bot's own messages (Slack `bot_id`,
Telegram `from.is_bot`, Matrix own sender) or notify→reply loops occur.

> **One Postmill org per bot/app** (documented limitation): Telegram `setWebhook` and the
> Slack/Discord/LINE endpoint URLs are global per app — a second org's config re-points inbound
> and silently darkens the first.

## Request flow

- **Webhook**: `POST /webhooks/comms/:identifier/:token`
  (`apps/backend/src/api/routes/comms-webhooks.controller.ts`, unauthenticated, 300/min per-IP
  throttle). Config lookup by token+identifier → **uniform 404** on any mismatch → verify →
  401 → `parseInbound` → enqueue `comms/inbound.message` events (event-id dedupe
  `comms-inbound:{configId}:{messageId}`) → return the first `ackResponse` or `{ok:true}`
  **immediately** (no AI work in-request).
- **Inngest** (`apps/backend/src/inngest/functions/comms-inbound.ts`, `comms-matrix-sync.ts`):
  `comms-inbound` (concurrency 1 per config) runs `CommsInboundService.process` — connect-code
  claim (+ in-app "account linked" notification to the user), silent-ignore for unknown
  senders, or an agent turn. `comms-matrix-sync` is a minutely cron fanning out
  `comms/matrix.sync-one` per enabled matrix config (concurrency 1 per config protects the
  cursor).
- **Agent turn** (`CommsAgentActivity`, mirrors `agent-digest.activity.ts`): budget + AI-config
  pre-checks (each degrades to a short DM), then `mastra.getAgent('postmill').generate` with
  `memory: {resource: orgId, thread: 'comms:{linkId}:{channelKey}'}` (deterministic → multi-turn,
  visible under `/agents/[id]`), RequestContext `user = the real linked user`,
  `access.mode = 'comms'` (recognized read+write in `chat/tools/tool.helpers.ts`), bounded by
  `COMMS_AGENT_TIMEOUT_MS` / `COMMS_AGENT_MAX_STEPS`. Errors collapse into an apology DM —
  internals never reach the chat app.
- **Notifications**: `notify()` (notification.service.ts) collects the active-member comms
  bucket and calls `CommsDeliveryService.sendToUsers` — gated per link row's `categories`
  (`override` bypasses, so broadcasts reach every linked user); failures are logged redacted
  and swallowed.

## Settings surface

`GET/PUT/POST/DELETE /settings/comms/...`
(`apps/backend/src/api/routes/comms-settings.controller.ts`, `settings:read`/`settings:update`).
`GET /config` returns providers (credentials masked to booleans) + link rows + the org member
list (deliberately NOT `/settings/team`, which carries a `TEAM_MEMBERS` billing policy).
Connect codes are returned **only** from link create / regenerate. Frontend:
`apps/frontend/src/components/settings/comms/{comms.tab,member-picker,category-checklist}.tsx`.

## Adding a comms provider

1. `libraries/providers/<id>/src/v1/comms.adapter.ts` — implement `CommsCapability`, export a
   `ProviderModule` with `manifest.domain: 'comms'` and the package's existing `metadata`
   (`kernel.metadata.spec` requires it); re-export in `src/v1/index.ts`, append to the array in
   `src/index.ts`. No `providers.generated.ts`/tsconfig edits for an existing package.
2. Declare `capabilities` honestly (`webhookInbound`/`pollInbound`/`threads`/
   `webhookRegistration`); implement only the optional methods that apply. Add
   `testConnection()` (credential check + non-secret `extra` facts to persist).
3. Spec: signature vectors (valid/invalid/skewed), `parseInbound` fixtures incl. challenge and
   bot-echo cases, outbound request shapes with a stubbed fetch.
4. Update `PROVIDERS_INVENTORY.md`, this doc's quirk table, and the conformance spec only if a
   new required method is introduced (unlikely).
