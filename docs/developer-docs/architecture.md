# Architecture

This document describes the architecture of Postmill for developers contributing to the codebase or building on its APIs.

## Monorepo layout

Postmill is a PNPM monorepo. Shared tooling lives in the root `package.json`; feature-specific code lives in workspace packages under `apps/` and `libraries/`.

```
postmill-app/
├── apps/
│   ├── backend/        # NestJS REST API + Inngest job handler
│   ├── frontend/       # Next.js App Router (port 4200)
│   ├── extension/      # Browser extension
│   ├── commands/       # CLI commands
│   └── sdk/            # Published Node.js SDK
├── libraries/
│   ├── nestjs-libraries/       # Prisma, repositories, business logic
│   ├── helpers/                # Shared utilities, useFetch hook
│   ├── react-shared-libraries/ # Shared React components
│   └── providers/              # Provider kernel + per-provider packages
└── docs/                       # VitePress documentation site
```

### Apps

| App | Stack | Purpose |
|-----|-------|---------|
| `backend` | NestJS REST API | Thin controllers + module wiring. Real logic lives in `nestjs-libraries`. Serves the Inngest handler at `/api/inngest`. |
| `frontend` | Next.js App Router, React, Tailwind 3 | User-facing web app on port `4200`. |
| `extension` | Browser extension | Chrome extension for cross-platform posting. |
| `commands` | CLI | Command-line operations. |
| `sdk` | Node.js (published) | `@postmill-ai/postmill-sdk` for third-party integrations. |

### Libraries

| Library | Purpose |
|---------|---------|
| `nestjs-libraries` | Prisma schema, repositories, services, integrations, AI layer, analytics, encryption, upload adapters. |
| `helpers` | Shared utilities including `useFetch` (SWR wrapper), auth helpers, decorators (`@Plug`, `@PostPlug`). |
| `react-shared-libraries` | Shared React components used across frontend surfaces. |
| `providers` | Provider kernel (`libraries/providers/kernel`) plus one workspace package per provider. |

## Backend layering

The backend enforces strict layering. **No shortcuts.** Only repositories touch Prisma.

```
Controller → Service → Repository
Controller → Manager → Service → Repository  (when a manager is involved)
```

- **Controllers** (`apps/backend/src/api/routes/`) handle HTTP, auth guards, validation, and delegate to services. Controllers are **thin** — no business logic.
- **Services** (`libraries/nestjs-libraries/src/database/prisma/<domain>/`) contain business logic. A service must go through another domain's **service**, not its repository.
- **Repositories** are the only layer that calls Prisma directly.
- **Managers** (`libraries/nestjs-libraries/src/integrations/`, `libraries/nestjs-libraries/src/ai/`) coordinate cross-cutting concerns.

Public API (v1) routes live in `apps/backend/src/public-api/routes/v1/` and are API-key authenticated.

See [Backend Conventions](./backend-conventions.md) for the full layering rules and sanctioned exceptions.

## Provider kernel

All provider domains resolve through a single **`ProviderKernel`** (`libraries/providers/kernel`). A provider is addressed as an identity triple: `domain/providerId@version` (for example, `ai/openai@v1` or `social/linkedin@v1`).

### Domains

The kernel supports nine provider domains:

| Domain | Examples | Stored config |
|--------|----------|---------------|
| `ai` | OpenAI, Anthropic, Google, Qwen | `AIOrgProviderConfig` |
| `media` | HeyGen, Runway, Replicate, OpenAI | `MediaProviderConfig` |
| `storage` | S3, R2, B2, IDrive E2, LOCAL | `StorageProviderConfig` |
| `shortlink` | Bitly, Dub, Short.io | `OrgShortLinkConfig` |
| `social` | X, LinkedIn, Instagram, Discord | `Integration` (connected channel) |
| `vpn` | NordVPN, custom SOCKS5/HTTP proxy | `OrgVpnConfig` |
| `contentpack` | Magnific, Vecteezy, Adobe Stock | `ContentPackConfig` |
| `email` | Resend, SendGrid, Mailgun | `EmailLog` + env bootstrap |
| `auth` | LOCAL, Google, GitHub, OIDC | `AuthProviderConfig` |

### Version lifecycle

Each provider version has one of four statuses:

| Status | Meaning |
|--------|---------|
| `preview` | Early access; must be explicitly opted into. |
| `active` | Default resolution target. |
| `deprecated` | Rejects new config rows; in-place updates of already-pinned rows are allowed. |
| `retired` | Returns `410 Gone`; no reads or writes. |

### Resolution

`ProviderResolutionService` (`libraries/nestjs-libraries/src/providers/provider-resolution.service.ts`) is the sole resolution path. It wraps every resolved capability in a telemetry proxy, caches instances by `(domain/providerId@version, orgId, credential-fingerprint)`, and records per-version health counters in the kernel. Config-mutation services must call `invalidate()` after credential changes so the next resolve rebuilds the adapter with fresh credentials.

### Catalog and health APIs

- `GET /providers/catalog?domain=` — authenticated catalog of registered providers. Unknown `?domain=` returns `400`.
- `GET /admin/providers/health?domain=` — super-admin per-version health counters.

See [Provider Framework](./provider-framework.md) and [Provider Versions](./provider-versions.md) for more detail.

## Frontend conventions

- **Next.js App Router**: Pages in `apps/frontend/src/app/(app)/(site)/`.
- **Data fetching**: Every API call uses **SWR** through the `useFetch` hook from `libraries/helpers/src/utils/custom.fetch.tsx`. Each SWR call must be its **own hook** per `react-hooks/rules-of-hooks`.
- **Styling**: Tailwind 3 with CSS variables defined in `apps/frontend/src/app/colors.scss`. All `--color-custom*` variables are deprecated. Always check existing components before building new ones.
- **Components**: UI primitives in `apps/frontend/src/components/ui/`; feature components in `apps/frontend/src/components/`. Use the shared bespoke primitives first, then Mantine for the few primitives where bespoke would be wasteful.
- **Error boundaries**: App Router segment boundaries ship `error.tsx` + `not-found.tsx`; the `/media/*` canvas studios are wrapped in `StudioErrorBoundary`.

See [Frontend Conventions](./frontend-conventions.md) for the full policy.

## How a post gets published

1. User creates a post in the composer. A **preflight** validation (`POST /posts/preflight`) checks content, media, and provider capabilities.
2. Post is saved to the database with a scheduled date and `state = QUEUE`.
3. At the scheduled time, the Inngest `post/publish` function picks up the post, sleeps until the publish date, and calls `PostActivity`.
4. `PostActivity` resolves the provider through `IntegrationManager` and calls `provider.post()`.
5. After a successful publish:
   - **Internal plugs** (`@PostPlug`) execute (one-shot post-publish actions, e.g. "have another account repost this").
   - If `settings.firstComment` is set and the provider supports it (gated via `providerCapabilities.firstComment`), the workflow posts a first comment. This is **idempotent** — it records `firstCommentPostedAt` so retries cannot double-post. Failure is **non-fatal** (the post stays published).
6. Webhooks fire for `post.published` events.

## How analytics works

1. An Inngest `analyticsCollection` function runs one sweep per org on a daily cron schedule.
2. Each sweep calls `AnalyticsActivity` which queries channel analytics (7-day lookback for channel metrics, 30-day lookback for per-post metrics).
3. Results are saved as daily `AnalyticsSnapshot` and `PostAnalyticsSnapshot` rows.
4. After ~18 months, `pruneAndRollupSnapshots()` rolls daily rows into weekly: flow metrics summed, stock metrics keep the week's latest value.
5. Per-post snapshots are pruned after 90 days. Both windows are configurable via `ANALYTICS_DAILY_RETENTION_DAYS` and `ANALYTICS_POST_RETENTION_DAYS`.
6. The `/analytics/v2` endpoints serve persisted data. Legacy `/public/v1/analytics/*` and `/analytics/*` routes are kept for backward compatibility (n8n/Zapier/Make integrations) — never change their response shape.

## Background jobs (Inngest)

All scheduled and async work runs on Inngest. The backend serves the handler at `/api/inngest`. Functions are created in `apps/backend/src/inngest/functions/`; heavier domain logic lives in `libraries/nestjs-libraries/src/inngest/activities/`.

| Function | Trigger | Purpose |
|----------|---------|---------|
| `post/publish` | Event | Sleep until publish date, post, post thread items, first comment, webhooks, plugs. |
| `autopost/process` | Event | RSS/feed autoposting. |
| `integration/refresh-token` | Event | Refresh channel OAuth tokens. Each cycle reschedules with a unique idempotency id; `integration/refresh-token/cancel` (channel delete / reconnect) stops the chain, which also terminates on a missing expiry, a `refreshNeeded` flag, or 5 failed cycles. |
| `email/send` | Event | Send transactional email (global 1/sec). |
| `email/digest` | Event | Daily/weekly digest flush. |
| `agent/digest` | Event | Per-org agent digest. |
| `analytics/backfill` | Event | Backfill analytics for a channel or post. |
| `analytics/collection` | Cron | Daily snapshot sweep. |
| `analytics/sync-org` | Cron | Org-level analytics sync. |
| `analytics/sync-integration` | Cron | Per-integration analytics sync. |
| `comments-collection` | Cron | Sync comments, dispatch webhooks, prune, notify. |
| `media-jobs-poll` | Cron | Poll pending external media jobs; re-enqueue stuck local renders. |
| `media/render` | Event | Local video render (Designer timeline + clip merge). |
| `media-jobs-poll-job` | Event | Individual media job poll helper. |
| `missing-post-finder` | Cron | Recover posts that should have published. |
| `streak/start` | Cron | Streak notifications. |
| `campaign-tag-purge` | Cron | Purge tagged campaign items for ended campaigns. |
| `retention-purge` | Cron | Prune analytics, email logs, and other retention-bound data. |
| `refresh-token` | Cron | Bulk token refresh sweep. |

Events are only sent when `USE_INNGEST=true`. Locally, run the Inngest dev server with `INNGEST_DEV=1`; in production, set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.

## Cross-cutting concerns

| Concern | Implementation |
|---------|---------------|
| **SSRF protection** | All outbound HTTP on user-influenced URLs goes through `safeFetch` (validates HTTPS, validates redirects per-hop) in `libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts`. |
| **At-rest encryption** | `EncryptionService` (AES-256-GCM, `v2:` prefix) encrypts OAuth tokens, API keys, credentials, and Nostr keys. Falls back to deriving a key from `JWT_SECRET` if `ENCRYPTION_KEY` is unset. |
| **CSRF** | CSRF middleware on cookie-authenticated mutating routes. Bypassed under `NOT_SECURED` (dev only). Header/API-key clients are unaffected. |
| **Helmet** | HSTS (1 year, includeSubDomains, preload), `noSniff`, `referrerPolicy`, `frameguard: deny`, conservative CSP. Gated by `NOT_SECURED`. |
| **Throttling** | `ThrottlerBehindProxyGuard` applies default per-route limits. Global default: `API_LIMIT` env var (600/hour). |
| **Sentry** | `beforeSend`/`beforeBreadcrumb` scrubs auth headers, tokens, PII. OpenAI capture disabled (`recordInputs: false`). |
| **JWT** | Algorithm pinned to `HS256`. New tokens carry `exp` with sliding renewal. Legacy exp-less tokens still verify. |
| **Validation** | Global `ValidationPipe` rejects unknown fields (`whitelist` + `forbidNonWhitelisted`). |

## Email adapter system

The email layer is a pluggable adapter system:

- **Adapters**: Resend, SendGrid, Mailgun, Postmark, Amazon SES, SMTP (nodemailer). Each implements `EmailAdapter` with `send()`, `isConfigured()`, and optional `verifyWebhook()` / `parseWebhook()`.
- **Selection**: `EMAIL_PROVIDER` picks the adapter. Unset/unknown → `EmptyAdapter` and `hasProvider() === false`.
- **Lazy construction**: SDK clients are built inside methods, not at module load.
- **Delivery lifecycle**: `EmailLog` records `queued` → `sent` → `delivered`/`bounced`/`complained`/`opened`/`clicked`. Status never downgrades; terminal negatives cannot be overwritten.
- **Webhook ingestion**: `POST /webhooks/email` is signature-verified and CSRF-exempt. SES also handles SNS `SubscriptionConfirmation` via `safeFetch`.
- **Retention**: `pruneEmailLogs()` in the analytics sweep deletes rows older than `EMAIL_LOG_RETENTION_DAYS` (default 90).

## Identity, profile, and sessions

The `User` table keeps identity/auth columns only: `email`, `password`, `providerName`, `providerId`, `isSuperAdmin`, `activated`, `lastOnline`, `ip`, `agent`, `lastReadNotifications`. The `@@unique([email, providerName])` key is preserved — the same email may exist once per login provider.

- **`UserProfile`** (1:1, cascade) carries profile fields: `name`, `lastName`, `bio`, `avatarUrl` (external avatar with Gravatar fallback), `pictureId` (user-uploaded image), IANA `timezone`, and notification preferences.
- **`Session`** backs refresh-token rotation: login creates a session storing `tokenHash = sha256(refreshToken)`; `POST /auth/refresh` rotates the hash; **reuse of a rotated hash revokes the session**; logout revokes all sessions. The JWT access token is unchanged (HS256, sliding renewal).

See [Data Model](./data-model.md) for the full schema breakdown.

## RBAC

Full role-based access control replaces the dropped legacy `Role` enum:

- **`AppRole`** — org-scoped roles; `organizationId = NULL` rows are seeded system roles (`owner`, `admin`, `editor`, `member`, `viewer`, `isSystem: true`). Orgs can create custom roles via `/settings/roles` or the Settings → Workspace → Roles tab.
- **`Permission`** — seeded `(resource, action)` catalog: 16 resources × 5 actions. The seeder is idempotent.
- **`AppRolePermission`** — the join table. `manage` on a resource implies all actions.
- **`OrgRbacGuard` + `@RequirePermission(resource, action)`** gate routes at the controller level. Failure throws `ForbiddenException` → HTTP 403.

### Two orthogonal access gates

| Gate | Decorator | Question | Failure |
|------|-----------|----------|---------|
| Billing | `@CheckPolicies` + `PoliciesGuard` | Has this org **paid** for this feature? | HTTP **402** |
| RBAC | `@RequirePermission` + `OrgRbacGuard` | Is this member **allowed** to do this? | HTTP **403** |

A route may carry both; they are independent. `User.isSuperAdmin` (the platform operator flag) bypasses RBAC but not billing.

## Platform administration and login providers

`AuthProviderConfig` stores platform-wide login provider configs (one row per `Provider`, client ID/secret encrypted at rest). They are managed by the **separate administration app** (a distinct repository) — this repo ships no `/admin` frontend and no login-provider write API; it only *reads* `AuthProviderConfig`. Login providers resolve credentials **DB-first**; the `getLoginEnv()` env vars are the bootstrap fallback when no enabled DB row exists. `LOCAL` email/password auth is always available regardless of DB config (subject to `DISABLE_REGISTRATION`). OIDC SSO ships via the `Provider.GENERIC` row.

## Shared provider-surface foundation

The AI, Media, Storage, and Shortlinks settings surfaces share one foundation:

- **`ProviderIcon`** (`apps/frontend/src/components/shared/provider-icon.tsx`) — brand SVG icons for every provider across all four surfaces.
- **`accountFingerprint`** (`libraries/nestjs-libraries/src/utils/account-fingerprint.ts`) — stable SHA-256 fingerprint for unique-account constraints on `StorageProviderConfig`, `OrgShortLinkConfig`, and `MediaProviderConfig`.
- **`ProviderListShell`** (`apps/frontend/src/components/settings/shared/provider-list-shell.tsx`) — reusable provider-list layout.
- **`ProviderConfigDto`** (`libraries/nestjs-libraries/src/types/provider-config.types.ts`) — shared config response shape.

## Schedule pages

The post composer lives on dedicated routes: `/posts/post` (create — accepts `date`/`channel`/`content` query params) and `/posts/post/:id` (edit). Both render the shared `PostComposer` component; the time picker displays in the user's IANA timezone and saves UTC.

> Verified against v1.0.0
