# ARCHITECTURE.md

System architecture of the Postmill monorepo for AI coding agents: structure, data flow,
and invariants. This is not a how-to — task-oriented procedures live in `agents/*.md` and
are cross-referenced by path. Every claim below was verified against the code at the time
of writing; where this file and the code disagree, the code wins.

Postmill is an open-source, AI-native platform to schedule social-media and chat posts to
36+ channels: scheduled publishing, a calendar view, persisted analytics, team management
(RBAC), and a media library with AI generation studios.

## 1. System overview

```
  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐
  │   Browser    │  │  Extension   │  │ SDK / n8n / Zapier  │
  │  (SPA user)  │  │ apps/extension│  │   (apps/sdk, API key)│
  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘
         │                 │                     │
         ▼                 │                     ▼
  ┌─────────────────────┐  │            ┌─────────────────────┐
  │  apps/frontend       │  │            │  Public REST API     │
  │  Next.js App Router  │  │            │  /public/v1/*        │
  │  port 4200           │  │            │  (PublicApiModule)   │
  └─────────┬───────────┘  │            └──────────┬──────────┘
            │ SWR via useFetch (@postmill-ai/helpers)          │
            ▼                 ▼                     ▼
  ┌───────────────────────────────────────────────────────────┐
  │  apps/backend — thin NestJS REST API (port 3000)          │
  │  controllers + middleware + Inngest serve (/api/inngest)  │
  │  real logic lives in libraries/nestjs-libraries           │
  └──────┬──────────────┬──────────────┬──────────┬───────────┘
         ▼              ▼              ▼          ▼
   PostgreSQL       Redis        Inngest      ProviderKernel
   (Prisma 6.5,     (cache,      (all jobs:   (SOLE resolution path
   schema +         throttle,    publish,     for every external
   migrations in    queues)      analytics,   service: ai, media,
   nestjs-libraries)             email, …)    social, storage, …)
```

One process, four external systems: the NestJS backend is the only server; the frontend
is a Next.js SPA that talks to it over REST (`useFetch` + SWR); PostgreSQL holds all state
via Prisma; Redis backs throttling, caching, and queues; Inngest is the only background-job
orchestrator (its serve endpoint is hosted inside the backend itself at `/api/inngest`);
and every third-party service (AI models, social channels, media generators, storage,
short-links, VPN egress, email) is reached through the `ProviderKernel` — never through
ad-hoc registries or env-key fallbacks.

## 2. Repository layout

PNPM monorepo; workspaces driven by `pnpm --filter`. **pnpm only — never npm/yarn.**

| Path | What it is |
|---|---|
| `apps/backend` | Thin NestJS REST API: controllers, middleware, Inngest function definitions + serve handler at `/api/inngest`. Business logic does **not** live here. |
| `apps/frontend` | Next.js App Router + React, port 4200, Tailwind 3, Sentry-instrumented. |
| `apps/extension` | Browser extension. |
| `apps/commands` | CLI commands. |
| `apps/sdk` | Published SDK, npm name `@postmill-ai/postmill-sdk`. |
| `libraries/nestjs-libraries` | The bulk of all server logic: services, managers, Prisma schema + migrations, repositories, Inngest activities, provider resolution. |
| `libraries/helpers` | Shared isomorphic utilities: `useFetch` (`src/utils/custom.fetch.tsx`), `AuthService` JWT helpers, `ConfigurationChecker`. |
| `libraries/react-shared-libraries` | Shared React components/hooks (canonical `Button`, `Input`), i18n (`useT`). |
| `libraries/providers` | Unified provider framework: `kernel/` + ~150 provider packages, one directory per provider id. |
| `tools/` | Repo-owned tooling, **not a workspace**: `tools/db` (migration/backfill helpers, incl. two CI schema gates) and `tools/codegen` (generators whose output is committed and drift-gated). |
| `docker/` | All Docker artifacts except the three pinned at the root — `Dockerfile` (the published image), `docker-compose.yaml` (its directory sets the Compose project name, hence the volume prefix), and `.dockerignore` (read from the build-context root). |
| `e2e/` | Playwright suite, auth setup, and seed data. |
| `agents/` | Agent-facing how-to docs (see §11). |

> Root `scripts/` is maintainer-local and gitignored — a fresh clone does not have it. Anything CI,
> a workspace script, or a doc depends on belongs in `tools/`.

Import aliases (`tsconfig.base.json` `compilerOptions.paths`):

| Alias | Resolves to | Note |
|---|---|---|
| `@postmill-ai/backend/*` | `apps/backend/src/*` | Alias only — the package's real name is `postmill-backend`. |
| `@postmill-ai/frontend/*` | `apps/frontend/src/*` | |
| `@postmill-ai/helpers/*` | `libraries/helpers/src/*` | Matches package name `@postmill-ai/helpers`. |
| `@postmill-ai/nestjs-libraries/*` | `libraries/nestjs-libraries/src/*` | Matches package name. |
| `@postmill-ai/react/*` | `libraries/react-shared-libraries/src/*` | **≠ package name** (`@postmill-ai/react-shared-libraries`). Import via the alias, not the package name. |
| `@postmill-ai/extension/*` | `apps/extension/src/*` | |
| `@postmill-ai/provider-kernel` | `libraries/providers/kernel/src` (+`/*`) | |
| `@postmill-ai/provider-<id>` | `libraries/providers/<id>/src` (+`/*`) | One alias pair per provider package (~150). |

At runtime the backend resolves bare `@postmill-ai/provider-*` imports through
`apps/backend/src/register-provider-paths.ts`, which must be the first import in
`main.ts` (see §3).

Deep tour of the libraries: `agents/libraries.md`.

## 3. Request lifecycle

### Boot order (`apps/backend/src/main.ts`)

1. `import './register-provider-paths'` — first line; installs the runtime resolver for
   bare `@postmill-ai/provider-*` imports before any transitive require of a provider package.
2. `initializeOtel()` (`@postmill-ai/nestjs-libraries/otel/initialize.otel`) — before Sentry
   and before Nest creation so auto-instrumentations patch modules as they load; no-op
   unless configured (`DEV_DISABLE_OPENTELEMETRY`).
3. `initializeSentry('backend', true)` (`@postmill-ai/nestjs-libraries/sentry/initialize.sentry`).
4. `BigInt.prototype.toJSON = Number` — Express `JSON.stringify` throws on BigInt columns
   (e.g. `StorageProviderConfig.quotaBytes`); serialized as JS number.
5. `NestFactory.create(AppModule, { rawBody: true, cors: … })` — CORS allowlist:
   `FRONTEND_URL`, `http://localhost:6274` (Inngest dev), optional `MAIN_URL`.
6. `app.enableShutdownHooks()` + SIGTERM/SIGINT → `app.close()` once (drains Redis/Prisma).
7. Socket.IO `IoAdapter` on the same HTTP server (`/collaboration`, `/ai-designer` namespaces).
8. `await startMcp(app)` — MCP server (`@postmill-ai/nestjs-libraries/chat/start.mcp`).
9. Global `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })`
   — unknown DTO fields are rejected; declare new optional fields on the DTO.
10. `json({ limit: '50mb' })` only on `/copilot/{*splat}` and `/posts` (Express 5 wildcard
    syntax — a bare `*` throws under path-to-regexp v8).
11. `cookieParser()`, `compression()`.
12. `helmet(...)` — applied **unless** `isDev()` or (`NOT_SECURED` + `NODE_ENV==='development'`).
    Quirk (documented in code): `isDev()` is also true when `NODE_ENV` is unset, so an
    unset-`NODE_ENV` deploy gets no helmet. `NOT_SECURED` in production does **not** strip helmet.
13. Global filters, in registration order: `SubscriptionExceptionFilter` →
    `PostValidationExceptionFilter` → `HttpExceptionFilter`
    (`@postmill-ai/nestjs-libraries/services/exception.filter`). Additional `APP_FILTER`s from
    `AppModule`: Sentry `FILTER`, `PROVIDER_NOT_CONFIGURED_FILTER`, `SHORT_LINK_PROVIDER_FILTER`,
    `ProviderExceptionFilter` (maps kernel errors → HTTP; retired → 410).
14. `loadSwagger(app)`.
15. `checkConfiguration()` — `ConfigurationChecker` (`@postmill-ai/helpers/configuration/configuration.checker`)
    runs **before** listen; fatal-missing secrets exit non-zero in production or under
    `CONFIG_CHECK_STRICT` (`NOT_SECURED` bypasses the exit).
16. `app.listen(port)` (`PORT` default 3000; `BACKEND_LISTEN_HOST` optional), then
    `CollaborationGateway.initialize(server, jwtAuthFn)`.

### Per-request pipeline

```
HTTP → RequestIdMiddleware ('*', AppModule.configure)
     → ThrottlerBehindProxyGuard   (APP_GUARD #1; Redis-backed, per client IP)
     → PoliciesGuard               (APP_GUARD #2; billing gate → HTTP 402)
     → OrgRbacGuard                (APP_GUARD #3; @RequirePermission → HTTP 403)
     → AuthMiddleware              (per-controller, via ApiModule — see below)
     → CsrfMiddleware              (per-controller, same list)
     → AiGuardMiddleware           (POST /copilot/chat, POST /copilot/agent)
     → Controller → Service → Repository → Prisma
```

Guard registration order in `apps/backend/src/app.module.ts` is exactly throttle → policies →
RBAC. `User.isSuperAdmin` bypasses RBAC, **not** the billing gate. Throttler default:
600 req/hour, override via `API_LIMIT`. The bucket is **per (controller, handler, org)** —
the tracker is `req.org?.id`, falling back to the client IP only for unauthenticated routes —
so it is not one shared budget across the API. Sensitive routes carry tighter per-minute
`@Throttle` decorators, and endpoints the frontend polls every few seconds raise the hourly
cap; storage is `ThrottlerStorageRedisService` on the shared `ioRedis`.

Authentication/CSRF are **middleware applied per controller list**, not global guards:
`apps/backend/src/api/api.module.ts` defines `authenticatedController = [ … ]` and
`ApiModule.configure` applies `AuthMiddleware` + `CsrfMiddleware` to exactly that list
(~50 controllers). A new authenticated controller must be added to that array or it serves
without auth/CSRF. CSRF is enforced on cookie-authenticated mutating routes; header/API-key
clients are unaffected. The public API (`/public/v1/*`, `PublicApiModule`) authenticates by
API key instead.

## 4. Layering rules

```
Controller → Service → Repository → Prisma
Controller → Manager → Service → Repository   (when a manager is involved)
```

- Only repositories (`*.repository.ts` under
  `libraries/nestjs-libraries/src/database/prisma/<domain>/`) touch Prisma.
  Controllers/services never call Prisma directly.
- Logic lives in `libraries/nestjs-libraries`, not `apps/backend` — the backend app is
  controllers, middleware, guards, and module wiring only.
- A service crosses domains through another domain's **service**, not its repository.
- Sanctioned exception 1: seeders/migration steps under `database/seeds/**`
  (`BackfillService`, `RbacSeeder`) use `PrismaService` + `$transaction` directly.
- Sanctioned exception 2: cross-domain **leaf-reads** where routing up through the owning
  service would create a Nest DI cycle. Each carries a
  `// layering: sanctioned leaf-read` comment (grep that string for the live list, e.g.
  `apps/backend/src/services/auth/permissions/permissions.service.ts:51`). Keep them;
  do not "fix" them into service calls.

Full rules and examples: `agents/backend.md`.

## 5. Provider kernel

All external-service domains resolve through a single `ProviderKernel`
(`libraries/providers/kernel/src/kernel.ts`). One workspace package per provider
(`libraries/providers/<id>`), each version an internal module (`src/v1`, `src/v2`, …).

- **Identity triple:** `domain/providerId@version` (e.g. `ai/openai@v1`).
  Nine domains: `ai`, `media`, `storage`, `shortlink`, `social`, `vpn`, `contentpack`,
  `email`, `auth` (`ProviderDomain` in `kernel/src/identity.ts`).
- **Version lifecycle** (`kernel/src/manifest.ts`, `ProviderVersionStatus`):
  `preview → active → deprecated → retired`. `resolveForWrite` rejects newly pinning a
  `deprecated` version (`allowDeprecated` permits in-place updates of rows already pinned),
  rejects `preview` unless `allowPreview`, and `retired` is terminal — reads and writes throw
  `ProviderVersionRetiredError`, mapped to **HTTP 410 Gone** by
  `apps/backend/src/api/filters/provider-exception.filter.ts` (body carries
  `{ providerId, version, latestActive }`). Prerelease semver versions must be `preview`.
- **Sole resolution path:** `ProviderResolutionService`
  (`libraries/nestjs-libraries/src/providers/provider-resolution.service.ts`). The legacy
  in-memory registries and the `PROVIDER_KERNEL=legacy` kill switch were removed — do not
  reference them as live.
- **Boot flow:** `apps/backend/src/providers.generated.ts` (hand-maintained despite the name;
  the one-shot scaffold was removed — keep imports/spreads alphabetical) exports
  `providerModules` → `ProvidersBootstrap` (`apps/backend/src/providers.bootstrap.ts`,
  `onModuleInit`) registers each module into the kernel via
  `this._kernel.register(mod)`. `ProviderManifestError` (malformed manifest, duplicate
  registration) is **fatal to boot**; other registration failures are logged and skipped.
  Domain gating via `FeatureFlagsService`: `ai`/`media`/`shortlink`/`email` honor
  `DEV_DISABLE_AI` / `DEV_DISABLE_MEDIA` / `DEV_DISABLE_SHORTLINKS` / `DEV_DISABLE_EMAIL`;
  the `empty` email provider registers regardless (always-on fallback); `social`, `storage`,
  `vpn`, `contentpack`, `auth` always register.
- **Config storage per domain** (all models in
  `libraries/nestjs-libraries/src/database/prisma/schema.prisma`, secrets AES-GCM encrypted):
  - Per-org rows: `AIOrgProviderConfig`, `MediaProviderConfig`, `StorageProviderConfig`,
    `OrgShortLinkConfig`, `OrgVpnConfig`, `ContentPackConfig`, plus channel credentials in
    `OrgProviderConfiguration`.
  - Email: env-selected — `EMAIL_PROVIDER` (accepts a bare id or qualified `id@version`,
    e.g. `mailgun@v2`) in `libraries/nestjs-libraries/src/emails/email-adapter.registry.ts`;
    unset → `empty` adapter (no-op).
  - Auth: platform-managed `AuthProviderConfig`, read-only in this repo (see §8).
- Every config/ledger row carries a non-null `version` column and keeps it until an explicit
  upgrade — a new `v2` adapter cannot silently change existing behavior.
- Catalog/health APIs: `GET /providers/catalog?domain=` (authenticated; unknown domain → 400),
  `GET /admin/providers/health?domain=` (super-admin).

Overview + 9 domain docs: `agents/providers/overview.md`, `agents/providers/<domain>.md`.

## 6. Key data flows

### (a) Post publish

```
schedule (PostsController → PostsService → PostsRepository)
  → Inngest function post-publish-${taskQueue}     (apps/backend/src/inngest/functions/post-publish.ts;
                                                    one function per provider taskQueue,
                                                    provider-scoped concurrency limit)
  → PostActivity                                   (libraries/nestjs-libraries/src/inngest/activities/post.activity.ts;
                                                    step.run per durable step, claimForPublish atomic claim)
  → IntegrationManager.getSocialIntegration + requireClientInformation
                                                 (libraries/nestjs-libraries/src/integrations/integration.manager.ts)
  → credential resolution, in order:
      1. per-org OrgProviderConfiguration (named sets; org's own app always wins)
      2. platform OAuth app from deployment env (channel-env-credentials.ts) —
         CHANNELS ONLY, live per-request, presence-based, never persisted to a tenant row
  → provider adapter .post()                       (social provider from the kernel-resolved module)
  → status update (changeState) + analytics/webhook fan-out
```

Optional per-channel VPN egress: `OrgProviderConfiguration.vpnSelection` (JSON
`{ enabled, identifier, regionId, vpnVersion }`) routes outbound posting through a VPN
region's proxy — SOCKS5 or HTTP-CONNECT only
(`libraries/nestjs-libraries/src/vpn/vpn-dispatcher.factory.ts`). Deleting a VPN config
nulls orphaned `vpnSelection` rows (`org-vpn-config.service.ts`).

### (b) Analytics

```
Inngest cron analytics-collection (TZ=UTC 0 2 * * *; apps/backend/src/inngest/functions/analytics-collection.ts)
  → fan-out event analytics/sync-org (concurrency 5) → analytics-sync-integration (10)
  → AnalyticsActivity                              (libraries/nestjs-libraries/src/inngest/activities/analytics.activity.ts;
                                                    daily snapshots, webhook analytics.snapshot_complete)
  → rollup/retention                               (RetentionActivity; ANALYTICS_POST_RETENTION_DAYS default 90)
  → read API: /analytics/v2/*                      (apps/backend/src/api/routes/analytics.v2.controller.ts;
                                                    AnalyticsService + Overview/Detail/Insights/Export/Share services)
```

### (c) Media jobs

```
studio UI → MediaStudioController (/media/studio; apps/backend/src/api/routes/media-studio.controller.ts)
  → MediaStudioService            (libraries/nestjs-libraries/src/media/studio/media-studio.service.ts;
                                   provider-agnostic: descriptor + adapter hold all per-provider differences)
  → AIMediaJob ledger row (schema.prisma) + dispatch to adapter via ProviderResolutionService.resolveMedia
  → provider adapter (async job, webhook/poll completion)
  → StorageService (resolved storage provider) → media library
```

### (d) Notifications

```
feature code → NotificationService                (libraries/nestjs-libraries/src/database/prisma/notifications/notification.service.ts;
                                                   SINGLE chokepoint — never call EmailService from feature code)
  → per-user category/channel prefs (10 hardcoded categories)
  → email: EmailService → Inngest event email/send (libraries/nestjs-libraries/src/services/email.service.ts;
                                                    skipped when Inngest disabled)
  → in-app + push: PushNotificationService
```

## 7. Background jobs

Inngest is the **only** orchestrator — there is no poll loop and no `continueAsNew`.

- Client: `libraries/nestjs-libraries/src/inngest/inngest.client.ts` — exports `inngest`
  and `isInngestEnabled()` (gated by `USE_INNGEST=true|1`).
- Module: `inngest.module.ts` registers 12 activity classes (`PostActivity`,
  `AnalyticsActivity`, `CommentsActivity`, `EmailActivity`, `IntegrationsActivity`,
  `AutopostActivity`, `MediaJobsActivity`, `DigestActivity`, `CampaignActivity`,
  `RetentionActivity`, `AgentDigestActivity`, `InngestRunService`) — the **activities
  pattern**: functions in `apps/backend/src/inngest/functions/` contain only `step.run`
  orchestration; all side effects live in injected activity classes so steps stay durable
  and retriable.
- `InngestService` builds the function list in its constructor (before `InngestController`
  reads it) via `createFunctions(...)` from `apps/backend/src/inngest/functions/index.ts`.
- Serving: `InngestController` (`apps/backend/src/api/controllers/inngest.controller.ts`,
  `@Controller('/api/inngest')`, `@All()`) delegates to `inngest/express` via
  `apps/backend/src/inngest/serve.ts` — the backend hosts its own Inngest endpoint.
- Idempotency ids must be event-unique (e.g. `` `post_${post.id}_recovery_${uuidv4()}` ``);
  a constant id black-holes reschedules.

Function table and per-function detail: `agents/jobs.md`.

## 8. Identity, RBAC & sessions

- **Identity/profile split** (schema.prisma): `User` (line ~106) holds identity/auth columns
  (email, password, providerName, providerId, isSuperAdmin, activated, …); `UserProfile`
  (1:1) holds profile fields (name, bio, pictureId, timezone, notification prefs).
- **RBAC:** `AppRole` (org-scoped; `organizationId` NULL = system template; `key` =
  owner/admin/editor/member/viewer; `isSystem` = seeded, non-deletable) joined to
  `Permission` through `AppRolePermission`. Gating: `@RequirePermission(resource, action)`
  + `OrgRbacGuard` (403); the billing gate is separate (`@CheckPolicies` + `PoliciesGuard`, 402).
- **Permission catalog:** seeded by
  `libraries/nestjs-libraries/src/database/seeds/rbac-seeder.ts` — **18 resources × 5
  actions = 90 permissions**. Resources (exact): `posts`, `media`, `channels`, `analytics`,
  `comments`, `webhooks`, `autopost`, `settings`, `organization`, `members`, `brands`,
  `ai-config`, `media-config`, `storage-config`, `shortlink-config`, `billing`,
  `notifications`, `oauth_apps`. Actions: `create`, `read`, `update`, `delete`, `manage`.
  Owner gets `*:manage`; admin gets everything except `billing:manage` and
  `organization:manage` (the wildcard would imply org deletion); viewer is `*:read`.
- **Sessions & refresh tokens:** the `Session` model backs refresh-token rotation
  (implemented in `apps/backend/src/services/auth/auth.service.ts` +
  `usersService.rotateSessionToken`): login creates a session (stores `sha256(token)` as
  `tokenHash`, never the raw token); refresh rotates `tokenHash`; presenting a rotated-out
  hash revokes the live session (reuse detection); logout sets `revokedAt`.
  Access token: JWT HS256, verification pins `algorithms: ['HS256']`
  (`libraries/helpers/src/auth/auth.service.ts`), new tokens carry `exp` with sliding
  renewal and session-auth verify sites require `exp` (exp-less session tokens are
  rejected). `/user/sessions` lists active devices.
- **Platform auth providers:** `AuthProviderConfig` stores platform-wide login-provider
  configs (encrypted at rest), managed by a **separate administration app** (distinct repo).
  This repo only reads them: `AuthProviderManager`
  (`apps/backend/src/services/auth/providers/auth-provider.manager.ts`) is DB-first with an
  env-bootstrap fallback (env counts only when the provider's complete credential set is
  present: `POSTMILL_GENERIC_OAUTH=true` + `POSTMILL_OAUTH_CLIENT_ID/SECRET/AUTH_URL/TOKEN_URL`
  for OIDC via `Provider.GENERIC`). `LOCAL` auth is always available unless
  `DISABLE_REGISTRATION=true`.

## 9. Cross-cutting concerns

| Concern | Rule | Enforcement (file) |
|---|---|---|
| Encryption | Single deployment-wide AES-GCM key, `v2:` prefix. Per-org reads via `EncryptionService`; global reads via `AuthService.fixedEncryption` (same key, two routes). `ENCRYPTION_KEY` optional, falls back to deriving from `JWT_SECRET`. Never store secrets plaintext. | `libraries/nestjs-libraries/src/encryption/encryption.service.ts`; `libraries/helpers/src/auth/auth.service.ts` |
| SSRF | All user-influenced outbound HTTP via `safeFetch`: `isSafePublicHttpsUrl` + `ssrfSafeDispatcher` + manual per-hop redirect re-validation. `SSRF_ALLOWED_PRIVATE_CIDRS` is the self-hosted opt-in. | `libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts` |
| CSRF | Required on cookie-authenticated mutating routes; header/API-key clients unaffected. Applied to the `authenticatedController` list only. | `apps/backend/src/services/auth/csrf.middleware.ts`; `api.module.ts` |
| Throttling | On by default; 600/hour (`API_LIMIT` override) **per (controller, handler, org)** — per client IP (resolved behind proxy) only for unauthenticated routes. Tighter per-route `@Throttle` on sensitive routes, raised caps on polled job-status routes. Redis-backed. | `libraries/nestjs-libraries/src/throttler/throttler.provider.ts`; `apps/backend/src/app.module.ts` |
| Validation | Global pipe `whitelist` + `forbidNonWhitelisted` — unknown fields rejected. | `apps/backend/src/main.ts` |
| Feature flags | `DEV_DISABLE_AI`, `DEV_DISABLE_MCP`, `DEV_DISABLE_MEDIA`, `DEV_DISABLE_SHORTLINKS`, `DEV_DISABLE_EMAIL`, `DEV_DISABLE_VIDEO`, `DEV_DISABLE_AGENT`, `DEV_DISABLE_SENTRY`, `DEV_DISABLE_OPENTELEMETRY`, `DEV_DISABLE_CRON` — all default enabled. | `libraries/nestjs-libraries/src/feature-flags/feature-flags.service.ts` |
| Dev toggle | `NOT_SECURED` bypasses HSTS/helmet (dev only), CSRF, the CopilotKit policy gate, and config fail-fast. Dev/local only. | `apps/backend/src/main.ts` |
| Sentry | No secrets/PII in Sentry, error storage, or logs; scrubber is the backstop, capture disabled at source. | `libraries/nestjs-libraries/src/sentry/initialize.sentry.ts` |
| Redis | Never run blocking commands (BRPOP/BLPOP/BRPOPLPUSH) on the shared `ioRedis` client — they stall the per-request throttler. Use `ioRedis.duplicate()`. | `libraries/nestjs-libraries/src/redis/redis.service.ts` |
| i18n | `useT()` hook (client) / `getT()` (server) over react-i18next; fallback `en`. | `libraries/react-shared-libraries/src/translation/get.transation.service.client.ts` (sic — filename has the `transation` typo), `i18n.config.ts` |
| RTL | Tailwind `rtl:` variants; keep directional spacing logical-property-safe in new components. | `apps/frontend/tailwind.config.cjs` |
| BigInt | `BigInt.prototype.toJSON = Number` installed at boot — don't reintroduce raw BigInt into responses expecting strings. | `apps/backend/src/main.ts` |

## 10. Stability commitments

- **Schema changes are additive-only** without an expand-contract plan: new columns nullable
  or defaulted; renames/drops need a backfill + a later contract migration and must pass the
  destructive guard (`ALLOW_DESTRUCTIVE_SCHEMA=true`). Committed Prisma migrations applied via
  `prisma migrate deploy`; CI runs a drift gate (schema edit without a matching migration fails).
- **No env AI-key fallback, ever.** No active AI provider for an org ⇒ AI is off for that org
  across all four surfaces (utility, generator, agent, copilot). Never reintroduce an
  `OPENAI_API_KEY`-style env fallback. AI keys live in `AIOrgProviderConfig`, encrypted.
- **The kernel is the sole provider resolution path.** Do not add parallel registries,
  side-channel factories, or a `PROVIDER_KERNEL` mode switch.
- **Inngest idempotency ids are event-unique** (see §7) — this is a correctness invariant,
  not a style rule.

## 11. Pointers (agents/*.md)

| Doc | Read this when |
|---|---|
| `agents/README.md` | You need the full index of agent docs. |
| `agents/backend.md` | Adding/changing controllers, services, layering, middleware, guards. |
| `agents/frontend.md` | Working in `apps/frontend` — App Router, SWR hooks, routing. |
| `agents/ui-standards.md` | Building UI — canonical primitives (Button/Input/modals), Tailwind tokens. |
| `agents/libraries.md` | Navigating `libraries/*` in depth. |
| `agents/database.md` | Schema edits, migrations, seeders, repositories. |
| `agents/testing.md` | Running/writing Vitest suites, conformance specs, fixtures. |
| `agents/security.md` | Touching auth, encryption, SSRF, CSRF, throttling. |
| `agents/jobs.md` | Adding/modifying Inngest functions; the function table. |
| `agents/notifications.md` | Sending user-facing email/in-app/push; categories and prefs. |
| `agents/campaigns.md` | Campaign Hub features. |
| `agents/billing.md` | Plans, metering, the 402 policy gate. |
| `agents/video-rendering.md` | Video compute queue and workers. |
| `agents/providers/overview.md` | Anything touching the provider kernel or resolution. |
| `agents/providers/{ai,auth,contentpack,email,media,shortlink,social,storage,vpn}.md` | Working on a provider in that domain. |
