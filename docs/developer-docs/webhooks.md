# Webhooks

Postmill webhooks let you receive real-time notifications when events occur in your org. Webhooks are delivered via HTTP POST, dispatched through `safeFetch` for SSRF protection.

> **Two delivery paths.** `post.published` (plus the `test-ping` and `/webhooks/send` routes) uses a
> **signed, enveloped, retried** delivery. The comment and analytics events go through a separate,
> lighter dispatcher (`WebhooksService.dispatchEvent`) that is **unsigned, flat-bodied, and
> best-effort**. The differences are called out per-section below — don't assume `post.published`'s
> behavior applies to the other events.

## Webhook management

All endpoints under `/webhooks` are cookie-authenticated and org-scoped.

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/webhooks/` | — | List webhooks with delivery statistics |
| POST | `/webhooks/` | `webhooks:create` | Create a webhook |
| PUT | `/webhooks/` | `webhooks:update` | Update a webhook |
| POST | `/webhooks/test-ping/:id` | `webhooks:create` | Send a test ping |
| DELETE | `/webhooks/:id` | `webhooks:delete` | Delete a webhook |
| POST | `/webhooks/send` | `webhooks:create` | Generic signed dispatch to a URL |

### Creating a webhook

```http
POST /webhooks/
Content-Type: application/json

{
  "name": "My webhook",
  "url": "https://your-server.com/webhook",
  "integrations": [
    { "id": "cly..." }
  ]
}
```

The `integrations` array scopes which channels the webhook listens to. For `post.published`, only webhooks whose integration list is empty or contains the published channel receive the event. For **all other event types** (comment and analytics), the dispatcher only delivers to webhooks whose integration list is **empty** — an integration-scoped webhook does **not** receive comment or analytics events (`WebhooksService.dispatchEvent`, `webhooks.service.ts:42-44`).

### Updating a webhook

```http
PUT /webhooks/
Content-Type: application/json

{
  "id": "cly...",
  "name": "My webhook",
  "url": "https://your-server.com/webhook",
  "integrations": []
}
```

### Test ping

```http
POST /webhooks/test-ping/:id
```

Sends a signed test payload to the webhook URL using the same enveloped shape and `X-Postmill-Signature` header as `post.published` deliveries:

```json
{
  "event": "ping",
  "timestamp": "2026-06-09T00:00:00.000Z",
  "data": { "message": "This is a test ping from Postmill" }
}
```

Returns `{ success: true, status: 200 }` on success, or `{ success: false, status: 0, error: "..." }` on failure.

## Event types

| Event | Description |
|-------|-------------|
| `post.published` | A post has been successfully published to a channel. |
| `comment.new` | A new comment was received on a published post (per-comment during sync, or batched digest). |
| `comment.reply` | A reply was posted to an existing comment. |
| `analytics.snapshot_complete` | The daily analytics snapshot collection has completed for the org. |
| `analytics.anomaly_detected` | One or more analytics anomalies were detected during the daily sweep. |

## Delivery

### SSRF protection

All webhook deliveries go through `safeFetch` from `libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts`. This validates:

- URL scheme is HTTPS for public URLs.
- No internal/private IPs in DNS resolution.
- Manual per-hop redirect re-validation (no blind redirect following).

Private CIDRs can be allowed via `SSRF_ALLOWED_PRIVATE_CIDRS` (opt-in for self-hosted instances with internal targets).

### Payload format

The raw Prisma row is never shipped. **The envelope shape differs by delivery path:**

- **`post.published`** wraps its fields in a `{ event, timestamp, data: {...} }` envelope.
- **The comment and analytics events** are emitted **flat** — `{ event, ...fields }`, with the event
  fields spread at the top level and **no `data` wrapper** (`webhooks.service.ts:54`). The comment
  events also carry **no `timestamp`** field.

`post.published` (enveloped):

```json
{
  "event": "post.published",
  "timestamp": "2026-06-09T00:00:00.000Z",
  "data": {
    "postId": "clx...",
    "integrationId": "cly...",
    "providerIdentifier": "x",
    "integrationName": "My X account",
    "content": "The published post text",
    "url": "https://platform.com/post/123",
    "state": "PUBLISHED",
    "publishDate": "2026-06-09T00:00:00.000Z"
  }
}
```

`comment.new` (flat, no `timestamp`):

```json
{
  "event": "comment.new",
  "postId": "clx...",
  "commentId": "...",
  "content": "...",
  "authorName": "...",
  "integrationId": "cly..."
}
```

The batched digest path emits a different flat shape — `{ "event": "comment.new", "batchSize": 12, "timeframe": "..." }` (`comments.activity.ts:86-89`).

`comment.reply` (flat, no `timestamp`):

```json
{
  "event": "comment.reply",
  "postId": "clx...",
  "commentId": "...",
  "content": "...",
  "authorName": "..."
}
```

`analytics.snapshot_complete` (flat):

```json
{
  "event": "analytics.snapshot_complete",
  "orgId": "...",
  "timestamp": "2026-06-09T00:00:00.000Z"
}
```

`analytics.anomaly_detected` (flat):

```json
{
  "event": "analytics.anomaly_detected",
  "orgId": "...",
  "anomalies": [
    {
      "integrationId": "cly...",
      "integrationName": "...",
      "metric": "unique_impressions",
      "direction": "spike",
      "value": 1234,
      "baseline": 1000,
      "deviation": 0.234,
      "date": "2026-06-08",
      "topPostId": "clx..."
    }
  ],
  "timestamp": "2026-06-09T00:00:00.000Z"
}
```

### Retries

`post.published` deliveries are retried up to **3 times** with exponential backoff (1s, 2s) inside a durable Inngest `step.run`, and each attempt is bounded by `WEBHOOK_TIMEOUT_MS` (default `10000`). The comment and analytics dispatches are **best-effort without retry**, and they pass no timeout signal — they fall back to `safeFetch`'s default `OUTBOUND_HTTP_TIMEOUT_MS` (default `30000`), not `WEBHOOK_TIMEOUT_MS`.

### HMAC signing

**Signing is not universal.** Only three deliveries are signed with an HMAC-SHA256 `X-Postmill-Signature` header (formatted `sha256=<hex>`): **`post.published`** (`post.activity.ts:684,698`), the **test-ping**, and **`/webhooks/send`**. The comment and analytics events dispatched through `WebhooksService.dispatchEvent` are sent with **only** a `Content-Type` header and carry **no signature** (`webhooks.service.ts:51-55`) — receivers of those events cannot verify a signature.

For the signed deliveries, the signature is computed over the **exact serialized JSON body** using a **deployment-wide secret** — `WEBHOOK_SIGNING_SECRET`. When that env var is unset, the secret falls back to `JWT_SECRET`, so signing is always available for the paths that use it.

**Verification recipe (receiver side):**

```
expected = "sha256=" + hex(HMAC_SHA256(WEBHOOK_SIGNING_SECRET, rawRequestBody))
constant_time_equals(expected, header["X-Postmill-Signature"])
```

Use the raw request body bytes exactly as received (do not re-serialize), and a constant-time comparison.

The secret is deployment-wide, not per-webhook.

## Data model

- **`Webhooks`**: stores webhook URL, name, and event subscription.
- **`Webhooks.integrations`**: implicit many-to-many relation with `Integration` (Prisma manages the join table).

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `WEBHOOK_SIGNING_SECRET` | falls back to `JWT_SECRET` | HMAC key for the `X-Postmill-Signature` header |
| `WEBHOOK_TIMEOUT_MS` | `10000` | Per-request timeout for webhook dispatch |
| `OUTBOUND_HTTP_TIMEOUT_MS` | `30000` | Default `safeFetch` timeout |
| `SSRF_ALLOWED_PRIVATE_CIDRS` | — | Opt-in allowlist of private CIDRs for self-hosted internal targets |

> Verified against v1.0.0
