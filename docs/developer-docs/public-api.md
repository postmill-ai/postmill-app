# Public API

The Public API provides programmatic access for third-party integrations and automation. It is split into two groups:

- **Public API v1** — `/public/v1/*`, authenticated with an API key or OAuth token.
- **Legacy public routes** — `/public/*` outside `/public/v1`, kept for n8n/Zapier/Make compatibility where noted.

All v1 routes are org-scoped. Mutating routes support idempotency keys, and reads are rate-limited per org.

## Authentication

Pass the credential in the `Authorization` header as a raw string (no `Bearer` prefix):

```http
Authorization: pm_live_xxxxxxxx...
```

Two credential types are accepted:

| Type | Prefix | Where to create |
|------|--------|-----------------|
| API key | `pm_live_` | Settings → API Keys |
| OAuth access token | `pos_` | OAuth app authorization flow |

API keys are per-user, per-org. The resolved org and user's role are attached to the request, so RBAC and billing gates still apply. OAuth tokens are constrained to the scopes the user approved (`mcp:read`, `mcp:posts:write`).

On hosted instances with Stripe configured, the org must have an active subscription; otherwise the request returns `401`.

## Rate limiting

Public v1 routes are rate-limited by `API_LIMIT` (default **600 requests/hour** per org). Sensitive endpoints carry tighter `@Throttle` overrides, for example:

- `POST /oauth/token` — 20/min
- `GET /public/v1/analytics/overview` — 60/min
- `POST /public/agent` — 30/min
- `POST /public/t` — 60/min

## Pagination

`GET /public/v1/posts` returns at most **100** posts per call (also the default page size). Use the `cursor` offset for paging:

| Param | Description |
|-------|-------------|
| `?limit=` | 1–100; defaults to 100, hard-capped at 100. |
| `?cursor=` | Opaque offset returned by the previous page. |

If neither `limit` nor `cursor` is sent, the response is `{ posts }` for backward compatibility (still capped at 100). When paging is requested, the response is `{ posts, cursor }`; `cursor` is `null` on the last page.

## Idempotency

Mutating v1 endpoints accept an optional **`Idempotency-Key`** header. Repeating the same key within **24 hours** replays the first response instead of re-running the mutation. Keys are scoped per-org, so the same string from a different org is independent. Supported on:

- `POST /public/v1/posts`
- `POST /public/v1/upload`
- `POST /public/v1/upload-from-url`
- `DELETE /public/v1/posts/:id`
- `DELETE /public/v1/posts/group/:group`
- `DELETE /public/v1/integrations/:id`

If Redis is unavailable the header is ignored and the request proceeds normally. A concurrent duplicate returns `409`.

## Posts

Base: `/public/v1`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/public/v1/posts` | Create a post |
| GET | `/public/v1/posts` | List posts |
| DELETE | `/public/v1/posts/:id` | Delete a post by post ID (resolves group) |
| DELETE | `/public/v1/posts/group/:group` | Delete a post by group ID |
| PUT | `/public/v1/posts/:id/status` | Change post status |
| PUT | `/public/v1/posts/:id/release-id` | Update external release ID |
| GET | `/public/v1/posts/:id/missing` | Get missing content to fill for a post |
| GET | `/public/v1/find-slot/:id` | Find next free posting time slot |

Creating or scheduling a post validates that every referenced channel is connected and does not need reauthentication. Drafts are allowed on disabled channels so they can be reconnected before promotion.

`POST /public/v1/posts` is gated on `api:create` and `posts_per_month:create` billing policies.

## Media

Base: `/public/v1`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/public/v1/upload` | Upload a media file (`multipart/form-data`, field `file`) |
| POST | `/public/v1/upload-from-url` | Import media from a URL |
| POST | `/public/v1/generate-video` | Generate AI video |
| GET | `/public/v1/generate-video/:id` | Poll an async video generation job |
| POST | `/public/v1/video/function` | Call a provider tool, currently only `loadVoices` |

`POST /public/v1/generate-video` accepts `type` (`text-to-video`, `image-to-video`, `video-to-video`) and provider params in `customParams`. The response is backward-compatible with the legacy `{ id, status, jobId, path, name, pollUrl }` shape:

- If the artifact is returned synchronously, `status` is `completed` and `path` is the URL.
- If a job is queued, `status` is `pending` and `pollUrl` points to `GET /public/v1/generate-video/:id`.

A terminal `failed` status sets `pollUrl` to `''` and `error` to the failure reason.

## Integrations

Base: `/public/v1`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/integrations` | List connected integrations (filterable by `?group=`) |
| DELETE | `/public/v1/integrations/:id` | Delete a channel integration |
| GET | `/public/v1/integration-settings/:id` | Get integration rules, max length, settings schema, tools |
| GET | `/public/v1/social/:integration` | Get OAuth authorization URL for a provider |
| POST | `/public/v1/integration-trigger/:id` | Trigger a dynamic provider tool |
| GET | `/public/v1/groups` | List customer groups |
| GET | `/public/v1/is-connected` | Check whether the org has any active integration |

`GET /public/v1/social/:integration` supports pinning a provider version:

- Pass `providerId@version` as the path param (e.g. `x@v1`).
- Or pass `?version=v1` with a bare provider id.
- A bare id resolves the latest active version.
- An unknown or retired version returns `404` or `410`.

## Analytics

Base: `/public/v1` and `/public`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/analytics/overview` | Org overview with optional date range |
| GET | `/public/v1/analytics/campaign/:id` | Campaign-scoped analytics |
| GET | `/public/v1/analytics/anomalies` | Detected anomalies for the org |
| GET | `/public/v1/analytics/:integration` | Legacy single-channel analytics |
| GET | `/public/v1/analytics/post/:postId` | Legacy single-post analytics |

The static routes `/overview`, `/campaign/:id`, and `/anomalies` are registered before the catch-all `/:integration` route so they resolve correctly. The legacy `/analytics/:integration` response shape is preserved for n8n/Zapier/Make compatibility.

`GET /public/v1/analytics/overview` validates `from`/`to`, requires `to >= from`, and caps the window at 400 days.

## Notifications

Base: `/public/v1`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/v1/notifications` | Get paginated org notifications |

## Legacy public routes

Base: `/public`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/public/agent` | `AGENT_API_KEY` env var | Create an agent post |
| POST | `/public/t` | None | Track analytics/behaviour event |
| POST | `/public/modify-subscription` | JWT | Modify subscription billing |
| GET | `/public/stream` | None | Proxy-stream an external MP4 (SSRF-safe) |

## Internal integrations API

These routes sit under `/integrations` and are authenticated via cookie session. Mutating routes require CSRF protection and the appropriate RBAC permission.

### Integration management

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| POST | `/integrations/provider/:id/connect` | `channels:create` | Save a provider page after two-step auth |
| GET | `/integrations/:identifier/internal-plugs` | — | Get internal plug definitions for a provider |
| GET | `/integrations/customers` | — | List customer groups |
| PUT | `/integrations/:id/group` | `channels:update` | Update integration group assignment |
| PUT | `/integrations/:id/customer-name` | `channels:update` | Update integration customer name |
| GET | `/integrations/list` | — | Full integration list with capabilities |
| POST | `/integrations/:id/settings` | `channels:update` | Update provider additional settings |
| POST | `/integrations/:id/nickname` | `channels:update` | Set nickname and/or avatar |
| GET | `/integrations/social/:integration` | `channels:create` | Generate OAuth authorization URL |
| POST | `/integrations/:id/time` | `channels:update` | Configure posting time slots |
| POST | `/integrations/mentions` | `channels:update` | Search @mentions across providers |
| POST | `/integrations/function` | `channels:update` | Call a dynamic provider function |
| POST | `/integrations/disable` | `channels:update` | Disable a channel |
| POST | `/integrations/enable` | `channels:update` | Enable a channel |
| DELETE | `/integrations/` | `channels:delete` | Delete a channel |

`GET /integrations/social/:integration` accepts `?campaign=<uuid>` to auto-tag a newly connected channel onto that campaign.

### Plugs

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/integrations/plug/list` | — | List all available plug definitions |
| GET | `/integrations/:id/plugs` | — | Get plugs configured for an integration |
| POST | `/integrations/:id/plugs` | `channels:create` | Create or update plug configuration |
| PUT | `/integrations/plugs/:id/activate` | `channels:update` | Toggle plug active/inactive |

### Provider-specific

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/integrations/telegram/updates` | Poll Telegram bot for connect message |
| POST | `/integrations/moltbook/register` | Register a Moltbook agent |
| GET | `/integrations/moltbook/status` | Check Moltbook agent claim status |

## No-auth integration endpoints

Base: `/integrations`

Used during OAuth callbacks and public provider-page connection.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/integrations/` | All integration definitions (provider registry) |
| POST | `/integrations/social-connect/:integration` | OAuth callback handler |
| POST | `/integrations/public/provider/:id/connect` | Save provider page (public, state-gated) |
| POST | `/integrations/extension-refresh` | Refresh Chrome extension cookies |

## Errors

Common status codes:

- `400` — Validation error, missing fields, or malformed dates.
- `401` — Missing or invalid API key/OAuth token, or no active subscription.
- `403` — Insufficient OAuth scope or RBAC permission.
- `404` — Unknown resource.
- `409` — Idempotency conflict.
- `410` — Requested provider version has been retired.
- `429` — Rate limit exceeded.

> Verified against v1.0.0
