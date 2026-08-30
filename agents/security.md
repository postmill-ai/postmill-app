# Security invariants (do not break)

LLM-facing ruleset for the Postmill monorepo. Each rule: statement, why (one clause),
enforcement point (exact file/symbol). Cross-refs: `agents/backend.md`,
`agents/database.md`, `agents/providers/overview.md`, `agents/jobs.md`.

## AI keys — no env fallback

- **Never read `OPENAI_API_KEY` or any env AI key as a tenant fallback.** Why: a
  deployment's env key must never be silently billed/used as a tenant's AI. Enforcement:
  `AIModelProvider._resolveConfig` throws `AI_NOT_CONFIGURED_MESSAGE` when
  `OrgAiSettingsService.getActiveProvider(orgId)` returns null —
  `libraries/nestjs-libraries/src/ai/ai-model.provider.ts:241-248` (comment: the
  pre-v3.6.0 env-`OPENAI_API_KEY` fallback was removed in v3.6.3).
- No active AI provider for an org ⇒ AI is **OFF** for that org on all four surfaces:
  `AiScope = 'utility' | 'generator' | 'agent' | 'mcp'`
  (`libraries/providers/kernel/src/domains/ai.ts:58`; per-surface model defaults in
  `SURFACE_DEFAULTS`, `ai-model.provider.ts:48-53`).
- AI keys live in `AIOrgProviderConfig`, encrypted at rest (see Encryption below);
  decrypted per-request via `OrgAiSettingsService` → `EncryptionService`.

## ProviderKernel is the sole resolution path

- All provider domains resolve through `ProviderResolutionService`
  (`libraries/nestjs-libraries/src/providers/provider-resolution.service.ts`) backed by
  `ProviderKernel` (`@postmill-ai/provider-kernel`). Why: version pinning
  (`domain/providerId@version`) and lifecycle (`preview → active → deprecated →
  retired`; retired → `GoneException`) only work if nothing bypasses the kernel.
- The legacy in-memory registries and the `PROVIDER_KERNEL=legacy` kill switch were
  **removed** — do not reference them as live. (`PROVIDER_KERNEL` survives only as a
  Nest DI token, `libraries/nestjs-libraries/src/providers/provider-kernel.token.ts`.)

## Outbound HTTP — safeFetch only

- **All user-influenced outbound HTTP goes through `safeFetch`**
  (`libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts:99`). No bare
  `fetch(userUrl)` — DTO validation alone doesn't survive DNS rebinding or 30x
  redirects.
- Pipeline (enforced inside `safeFetch`): per-hop `isSafePublicHttpsUrl`
  (`./webhook.url.validator.ts`) → undici `fetch` with `redirect: 'manual'` +
  `dispatcher: ssrfSafeDispatcher` (`./ssrf.safe.dispatcher.ts`, DNS-pinned) → manual
  redirect loop (`MAX_REDIRECTS = 5`) re-validating every hop. Credential-class headers
  (`authorization`, `cookie`, `x-api-key`, … `CREDENTIAL_HEADER_NAMES`, :41-49) are
  stripped once a redirect leaves the original origin.
- Must use **npm undici's** `fetch`, not the global one — the v8 `Agent` dispatcher is
  incompatible with Node's built-in undici (comment :93-98).
- Timeouts: default 30 s (`OUTBOUND_HTTP_TIMEOUT_MS`), webhooks 10 s
  (`WEBHOOK_TIMEOUT_MS`), per-call `timeoutMs` capped at 300 s.
- `SSRF_ALLOWED_PRIVATE_CIDRS` (comma-separated CIDRs) is the opt-in for self-hosted
  internal targets; unset = all private ranges blocked (`.env.example:27`).

## Secrets at rest — EncryptionService

- **Never store secrets plaintext.** Encrypt via `EncryptionService`
  (`libraries/nestjs-libraries/src/encryption/encryption.service.ts`) — a thin wrapper
  over `AuthService.fixedEncryption`/`fixedDecryption`
  (`libraries/helpers/src/auth/auth.service.ts:100-113`).
- Algorithm: AES-256-GCM, random 12-byte IV, stored value prefixed `v2:`
  (`V2_PREFIX`, `auth.service.ts:5-8`). `fixedDecryption` is **GCM-only** (v1.0.0):
  it throws on any non-`v2:` value — the legacy AES-256-CBC read path and the
  deterministic CBC writer (`encryptDeterministic`) were removed. Pre-v1 stored
  values are rewritten to `v2:` at boot by the ledger-gated **"legacy secret
  re-encryption"** backfill step (`backfill.service.ts`, CBC reader:
  `database/seeds/legacy-cbc.crypto.ts`).
- Key: `ENCRYPTION_KEY` (base64/hex/raw, normalized to 32 bytes) if set, else derived
  as `sha256(JWT_SECRET)` (`getEncryptionKey`, `auth.service.ts:10-33`).
- **Single-key model:** one deployment-wide key encrypts every secret — there is NO
  per-org crypto key. "Org-scoped" means DB-column-scoped; cross-org isolation is
  enforced by query scoping (repositories filtering by `organizationId`), not by
  crypto. Per-org reads go through `EncryptionService`, global reads through
  `AuthService.fixedEncryption` — same key behind two routes; never cross them for one
  row.

## Redis — no blocking commands on the shared client

- **Never run `BRPOP`/`BLPOP`/`BRPOPLPUSH` on the shared `ioRedis` client.** Why: a
  blocked shared client stalls every pipelined command, including the per-request
  throttler check (`ThrottlerStorageRedisService(ioRedis)`,
  `apps/backend/src/app.module.ts:72`). Enforcement pattern: `ioRedis.duplicate()` for
  the blocking worker — exemplar `rag.service.ts:708`
  (`private readonly _workerRedis = ioRedis.duplicate()`).

## Inngest — idempotency ids must be event-unique

- A constant event `id` black-holes reschedules (Inngest dedupes on it). Why: refresh
  chains and recurring sends must each land as a new event. Enforcement examples:
  `apps/backend/src/inngest/functions/refresh-token.ts:81-83`
  (`` `refresh_${integrationId}_${randomUUID()}` ``, F3 comment);
  `autopost-process.ts:21` deliberately sends **no** id so hourly hops are not deduped;
  `post-publish.ts:512` keys repeats by post/index/createdAt. See `agents/jobs.md`.

## JWT

- Verification pins `algorithms: ['HS256']` — no `alg: none` / algorithm confusion.
  Enforcement: `AuthService.verifyJWT`, `libraries/helpers/src/auth/auth.service.ts:97`.
- New tokens carry `exp` (`signJWT` → `expiresIn: '30d'`, :93-94) with sliding renewal.
  v1.0.0: session-auth verify sites **require** `exp` (`auth-context.resolver.ts`, the
  collaboration socket in `apps/backend/src/main.ts`) — legacy exp-less session tokens
  are rejected. Non-session flows (invite/reset/activation/webhook/extension) verify
  only tokens they minted via `signJWT`, which always embeds `exp`.
- IDs/secrets use CSPRNG (`crypto.randomBytes`, `crypto.randomUUID`) — never
  `Math.random` for tokens.

## CSRF

- Required on cookie-authenticated mutating routes. Enforcement: every controller in
  the `authenticatedController` array (`apps/backend/src/api/api.module.ts:102`) gets
  `AuthMiddleware` + `CsrfMiddleware` via `consumer.apply(...).forRoutes(...)`
  (`api.module.ts:213-214`) — a new authenticated controller MUST be added to that
  array.
- `CsrfMiddleware` (`apps/backend/src/services/auth/csrf.middleware.ts`): unsafe
  methods only (POST/PUT/PATCH/DELETE, :14); only when auth came from the `auth`
  cookie (:20-30) — header/API-key clients are exempt; double-submit compare of
  `csrf_token` cookie vs `x-csrf-token` header with `crypto.timingSafeEqual`; mismatch
  → 403.

## Global ValidationPipe

- `whitelist: true` + `forbidNonWhitelisted: true` (+ `transform`)
  (`apps/backend/src/main.ts:112-118`). Why: undeclared body fields are rejected, so
  mass-assignment of unexpected columns fails closed. Consequence: declare every new
  optional field on its DTO (with a validator) or requests carrying it 400.

## Throttling

- Effective by default: `ThrottlerModule.forRoot` ttl 3 600 000 ms, limit
  `API_LIMIT || 600` per hour, Redis-backed (`apps/backend/src/app.module.ts:58-73`);
  applied globally as `APP_GUARD → ThrottlerBehindProxyGuard` (`app.module.ts:81-84`).
- **Bucket scope — read this before assuming a global budget.** The key is
  `${controllerName}-${handlerName}-${throttlerName}` (base `ThrottlerGuard.generateKey`,
  not overridden) combined with the tracker from
  `ThrottlerBehindProxyGuard.getTracker`, which returns `req.org?.id || clientIp` (plus a
  coarse `posts`/`other` suffix). So the limit is **per (handler, org)** for authenticated
  routes and **per (handler, client IP)** only for unauthenticated ones; `clientIp` comes
  from `X-Forwarded-For` via `TRUST_PROXY_HOPS` (never blanket-trusted).
- Sensitive routes carry tighter per-minute `@Throttle()` overrides (login 10/min,
  register 5/min, AI 10-30/min — comment :62-68). Endpoints the frontend **polls** at a
  few seconds (job status, notifications) must raise the hourly cap instead — a 5s poll is
  720/h and blows the 600/h default on its own.
- CopilotKit `/copilot/chat` is policy- and budget-gated:
  `@CheckPolicies([AuthorizationActions.Create, Sections.MCP])`
  (`apps/backend/src/api/routes/copilot.controller.ts:356-357`) plus a per-request
  `BudgetService.checkBudget('agent', …)` throw of `BudgetExceeded` (:216-218).

## NOT_SECURED — dev-only toggle

- `NOT_SECURED` relaxes transport hardening **only when
  `NODE_ENV === 'development'`**: `notSecuredDev = NOT_SECURED && NODE_ENV ===
  'development'` skips helmet (CSP/HSTS/frameguard/noSniff) (`main.ts:127-161`) and
  drops `Secure`/`sameSite` on auth/CSRF cookies (`csrf.middleware.ts:56-63`). Why the
  re-guard: a stray prod `NOT_SECURED` must not strip hardening wholesale.
- Accuracy note: `CsrfMiddleware`'s token check itself has no `NOT_SECURED` branch, and
  `copilot.controller.ts` contains no `NOT_SECURED` reference — the toggle relaxes
  cookie/helmet transport flags (and selected dev shortcuts elsewhere); it is not a
  general middleware bypass. Dev/local only, regardless.

## Sentry / logs — no secrets or PII

- Capture is disabled at source where possible; the scrubber is the backstop:
  `initializeSentry` (`libraries/nestjs-libraries/src/sentry/initialize.sentry.ts`).
  Enforcement points: `SENSITIVE_FIELDS` set (:8-13) redacting headers/cookies/body
  fields via `beforeSend` / `beforeSendTransaction` (:158-164) and `beforeBreadcrumb`
  (:166-176); `user.email`/`user.username` always `[REDACTED]` (:95-100); Inngest
  request bodies dropped (:89-92); `openAIIntegration({ recordInputs: false,
  recordOutputs: false })` (:146-149).
- Use Nest `Logger`, scrub values before logging; never log decrypted credentials,
  tokens, or request bodies. (Email service logs a sha256-truncated recipient id, not
  the address — `email.service.ts:174-176`.)

## Two orthogonal access gates

- **Billing gate** — `@CheckPolicies(...)`
  (`apps/backend/src/services/auth/permissions/permissions.ability.ts`) +
  `PoliciesGuard` (global `APP_GUARD`, `app.module.ts:85-88`) → throws
  `SubscriptionException`, rendered as HTTP **402** by `SubscriptionExceptionFilter`
  (`main.ts:162`). Question: "has this org paid?"
- **RBAC gate** — `@RequirePermission(resource, action)`
  (`apps/backend/src/services/auth/rbac/require-permission.decorator.ts`) +
  `OrgRbacGuard` (global `APP_GUARD`, `app.module.ts:89-92`) → `ForbiddenException`
  HTTP **403** (`org-rbac.guard.ts:98`). Question: "is this member allowed?"
- `User.isSuperAdmin` bypasses RBAC (`org-rbac.guard.ts:75`) — **not** billing. A route
  may carry both decorators.

## Channel credentials — org config wins, env fallback is channels-only

- Resolution funnels through `IntegrationManager.getClientInformation(integration,
  orgId, configId?)` (`libraries/nestjs-libraries/src/integrations/integration.manager.ts:345-380`):
  1. per-org `OrgProviderConfiguration` (encrypted at rest) always wins (:359-367);
  2. platform OAuth app from deployment env via `getEnvClientInfo`
     (`libraries/nestjs-libraries/src/integrations/channel-env-credentials.ts`, called
     at :370) powers click-connect when the org brought no keys.
- The env path is **live, per-request, presence-based, never persisted** to a tenant
  row — and **channels only**. AI, short-link, and other provider domains get NO env
  fallback (their creds come from encrypted org config rows via the kernel).

## Checklist

- [ ] No env AI-key read added anywhere; AI-off path still throws `AI_NOT_CONFIGURED_MESSAGE`.
- [ ] Provider resolution goes through `ProviderResolutionService` — no legacy registry references.
- [ ] New outbound HTTP to user-influenced URLs uses `safeFetch` (undici), not global `fetch`.
- [ ] New secrets encrypted via `EncryptionService` (`v2:` GCM); no plaintext secret columns.
- [ ] No `BRPOP`/`BLPOP`/`BRPOPLPUSH` on shared `ioRedis` — used `ioRedis.duplicate()`.
- [ ] New Inngest events have event-unique idempotency ids (or deliberately none).
- [ ] JWT verification still pins `['HS256']`; new tokens are CSPRNG-generated.
- [ ] New authenticated controllers are in `authenticatedController` (CSRF-covered).
- [ ] New DTO fields declared with validators (global pipe rejects unknown fields).
- [ ] New routes considered against `API_LIMIT` 600/h global throttle; sensitive ones got tighter `@Throttle`.
- [ ] No `NOT_SECURED` behavior assumed beyond dev; prod hardening untouched.
- [ ] No secrets/PII in Sentry breadcrumbs, logs, or stored errors.
- [ ] New gated routes chose the right gate(s): `@CheckPolicies` (402) and/or `@RequirePermission` (403); `isSuperAdmin` not treated as a billing bypass.
- [ ] Channel credential changes keep org-config-wins order and channels-only env fallback.
