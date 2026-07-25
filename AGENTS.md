# AGENTS.md

Guidance for AI coding agents working in this repository. **Postmill** is an open-source, AI-native
platform to schedule social media and chat posts to **36+ channels** — schedule posts, calendar view,
persisted analytics, team management, and a media library. Posts added to the calendar enter a
workflow and are published at the right time.

This file is the entry point (`CLAUDE.md` imports it). It carries only the load-bearing rules. The
agent development docs live next to it:

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — system architecture: layout, request lifecycle,
  provider kernel, data flows, identity/RBAC/sessions.
- **[`agents/`](./agents/README.md)** — the agent development docs: provider how-tos for all 9
  domains, UI standards, libraries map, backend/frontend recipes, database, testing, security, jobs,
  and subsystem deep-dives. **Read the doc for your task before writing code** — the index in
  [`agents/README.md`](./agents/README.md) maps tasks to docs.
- **[`agents/skills/`](./agents/skills/)** — executable skills (`<skill-name>/SKILL.md`): task
  procedures that wrap the docs (add a provider, new endpoint, schema change, new UI, …). When a
  request matches a skill, follow it.

`docs/` (the VitePress site) is documentation for **humans** — end users and self-hosters. It is not
agent development guidance; do not follow pointers there for development work. When you change a
convention, contract, or invariant, update the matching `agents/` doc in the same change.

## Version

The current release version is tracked in [`version.txt`](./version.txt) (now `v1.0.0`). **Bump it on
every release.** Root docs speak only of `v1.0.0` as the first public release; the inherited 3.x/4.x
numbering was pre-release internal development.

> **This system is in production with many users.** Before changing anything, be sure you are not
> breaking existing users — a data/schema change may need a migration story. Prefer
> backward-compatible changes.

## Repository layout

PNPM monorepo. Workspaces are driven by `pnpm --filter`. Dependencies are split between the root
`package.json` (shared tooling and cross-cutting packages) and per-workspace `package.json` files in
`apps/*` and `libraries/*` (feature-specific packages). Do not add a backend-only or frontend-only
package to the root manifest unless it is genuinely shared across multiple workspaces.

- `apps/backend` — NestJS REST API. Kept **thin**: controllers + module wiring. Real logic lives in
  libraries. Serves the Inngest handler at `/api/inngest`.
- `apps/frontend` — **Next.js (App Router) + React**, port `4200`. Tailwind 3, Sentry-instrumented.
- `apps/extension` — browser extension. `apps/commands` — CLI commands. `apps/sdk` — published SDK.
- `libraries/nestjs-libraries` — the bulk of shared server logic, Prisma schema, repositories. **Most
  backend logic belongs here.**
- `libraries/helpers` — shared utilities, incl. the `useFetch` hook. `libraries/react-shared-libraries`
  — shared React components (imported as `@postmill-ai/react/*`).
- `libraries/providers` — the unified provider framework (kernel + one package per provider).

Full directory tour, import aliases, and "where does new code go": [`agents/libraries.md`](./agents/libraries.md).

## Doc map

| Task | Read |
|---|---|
| Understand the system | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Add a provider (AI, social, media, storage, short-link, VPN, content pack, email, auth) | [`agents/providers/overview.md`](./agents/providers/overview.md) → the domain doc |
| Write any frontend UI | [`agents/ui-standards.md`](./agents/ui-standards.md) + [`agents/frontend.md`](./agents/frontend.md) |
| Add an endpoint / DTO / repository / job | [`agents/backend.md`](./agents/backend.md) (+ [`agents/jobs.md`](./agents/jobs.md) for Inngest) |
| Change the schema | [`agents/database.md`](./agents/database.md) |
| Write tests / run lint | [`agents/testing.md`](./agents/testing.md) |
| Touch auth, secrets, outbound HTTP | [`agents/security.md`](./agents/security.md) |
| Send a notification | [`agents/notifications.md`](./agents/notifications.md) |
| Campaigns / billing / video rendering | [`agents/campaigns.md`](./agents/campaigns.md) / [`agents/billing.md`](./agents/billing.md) / [`agents/video-rendering.md`](./agents/video-rendering.md) |

## Unified provider framework

All provider domains (AI, Media, Storage, Short-link, Social, VPN, Content Packs, Email, Auth) resolve
through a single **`ProviderKernel`** (`libraries/providers/kernel`), one workspace package per
provider (`libraries/providers/<id>`), each version an internal module (`src/v1`, `src/v2`, …).

- A provider is addressed as `domain/providerId@version` (e.g. `ai/openai@v1`). Every config/ledger
  row carries a non-null `version` column and keeps that version until an explicit upgrade. Lifecycle:
  `preview → active → deprecated` (rejects new writes) `→ retired` (returns `410 Gone`).
- **Resolution is through `ProviderResolutionService` — the kernel is the SOLE resolution path.** The
  legacy in-memory registries and the `PROVIDER_KERNEL=legacy` kill switch were **removed**; do not
  reference them as live.
- API: `GET /providers/catalog?domain=` (**authenticated**; unknown `?domain=` → **400**);
  `GET /admin/providers/health?domain=` (super-admin).
- Free stock providers (Unsplash, Pexels, Pixabay, GIPHY, Jamendo, Iconify) are intentionally outside
  versioning — no stored config row.

How to add a provider in any domain: [`agents/providers/overview.md`](./agents/providers/overview.md).

## Setup & commands

Use **pnpm only** — never npm or yarn.

```bash
pnpm install              # also runs prisma-generate via postinstall

# Develop (all apps in parallel)
pnpm run dev              # extension + backend + frontend
pnpm run dev:minimal      # backend + frontend only (recommended for daily dev)
pnpm run dev:backend      # backend only
pnpm run dev:frontend     # frontend only (port 4200)

# Build
pnpm run build            # frontend + backend

# Test (Vitest, per package)
pnpm run test             # helpers → providers → nestjs-libraries → backend → frontend → commands → sdk → extension
vitest run --root apps/backend            # run one package's tests

# Database (Prisma 6.5.0)
pnpm run prisma-generate  # regenerate client after editing schema.prisma
pnpm run prisma-db-push   # push schema to the DB (local prototyping/reset only)
```

- **Tests run on Vitest** (`vitest run --root <pkg>`). The old root `jest.config.ts` has been
  deleted — do not resurrect jest-style configuration. Details: [`agents/testing.md`](./agents/testing.md).
- **Lint runs from the repo root only**, via the flat `eslint.config.mjs` (eslint 9 +
  `eslint-config-next`). There is no per-package `lint` script.

## Local development performance

The stack is large; use the feature flags and lightweight commands below to keep your machine
responsive.

```bash
# Required services only: postgres + redis
docker compose -f docker-compose.dev.yaml up -d
# Add background jobs (Inngest dev server)
docker compose -f docker-compose.dev.yaml --profile jobs up -d

# Skip heavy optional subsystems (all flags default to enabled)
DEV_DISABLE_AI=true DEV_DISABLE_MCP=true DEV_DISABLE_MEDIA=true \
DEV_DISABLE_SHORTLINKS=true DEV_DISABLE_EMAIL=true pnpm run dev:minimal
```

Flags: `DEV_DISABLE_AI`, `DEV_DISABLE_MCP`, `DEV_DISABLE_MEDIA`, `DEV_DISABLE_SHORTLINKS`,
`DEV_DISABLE_EMAIL`, `DEV_DISABLE_VIDEO`, `DEV_DISABLE_AGENT`, `DEV_DISABLE_CRON`,
`DEV_DISABLE_SENTRY`, `DEV_DISABLE_OPENTELEMETRY`.

The backend dev script sets `--max-old-space-size=2048`. Frontend dev variants: `pnpm run
dev:frontend` (Turbopack), `pnpm run dev:webpack` (fallback), `pnpm run analyze` (bundle report).

## Golden rules

The one-paragraph version of the conventions — details and recipes in the linked docs.

- **Backend layering:** Controller → Service → Repository (→ Manager when involved). Only
  repositories touch Prisma. Logic lives in `libraries/nestjs-libraries`, not `apps/backend`.
  Sanctioned exceptions (seeders; `// layering: sanctioned leaf-read` sites) — keep them, don't
  "fix" them. Recipes and the full exception list: [`agents/backend.md`](./agents/backend.md).
- **Frontend:** bespoke primitives first — `Button`/`Input` from `@postmill-ai/react/form/*`,
  `useModals()` for modals; Mantine only for Autocomplete/dates/hooks; no new UI kits; no
  `--color-custom*` tokens; SWR via `useFetch`, one hook per resource, never eslint-disable a hook.
  The rulebook: [`agents/ui-standards.md`](./agents/ui-standards.md).
- **Database:** schema changes via committed migrations; `prisma migrate deploy` is the only apply
  path for shared/production DBs; new columns nullable or defaulted; destructive changes need
  expand-contract + `ALLOW_DESTRUCTIVE_SCHEMA=true`. Workflow: [`agents/database.md`](./agents/database.md).
- **Channel credentials:** per-org `OrgProviderConfiguration` (encrypted) always wins; the platform
  env OAuth-app fallback is live, per-request, never persisted, and **channels only** — AI,
  short-link, and other provider credentials do NOT get an env fallback. Resolution funnels through
  `IntegrationManager.getClientInformation`. Channels can opt into VPN-region proxy egress
  (SOCKS5/HTTP-CONNECT only).

### Numbers stated once (do not let them drift)

- **AI providers: 30** (17 direct + 13 hubs/gateways), BYOK, no env fallback.
- **Media tools: 46** = Designer + AI Designer + **38 provider studios** + **6 stock browsers**.
- **Channels: 36+.**
- **Background jobs: Inngest** (the previous workflow orchestrator was removed — there is **no
  `while(true)` poll loop and no `continueAsNew`**). Function catalog: [`agents/jobs.md`](./agents/jobs.md).
- **Notification categories: 10** — `post_published`, `post_failed`, `channels`, `comments`,
  `budget`, `media`, `announcements`, `streak`, `agent`, `analytics`. Hardcoded in three lockstep
  places (DTO, `DEFAULT_CATEGORY_TOGGLES`, frontend panel). `NotificationService` is the **single
  chokepoint** for user-facing email + in-app/push — never call `EmailService` directly from feature
  code. See [`agents/notifications.md`](./agents/notifications.md).

## Security invariants (do not break)

Condensed "don't break this" set. Full detail with enforcement points: [`agents/security.md`](./agents/security.md).

- **No env-`OPENAI_API_KEY` (or any env AI-key) fallback.** No active AI provider for an org ⇒ AI is
  **off** for that org across all four surfaces (utility, generator, agent, mcp). AI keys live in
  `AIOrgProviderConfig`, encrypted at rest.
- **The `ProviderKernel` is the sole resolution path** (see above).
- **All user-influenced outbound HTTP goes through `safeFetch`**
  (`libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts`). No bare `fetch(userUrl)`.
  `SSRF_ALLOWED_PRIVATE_CIDRS` is the opt-in for self-hosted instances.
- **Secrets at rest are encrypted via `EncryptionService`** (AES-GCM, `v2:` prefix). **Single-key
  model:** no per-org crypto key; cross-org isolation is enforced by query scoping. Per-org reads on
  `EncryptionService`, global reads on `AuthService.fixedEncryption` (same key, two routes — never
  cross them for one row). Never store secrets plaintext.
- **Never run blocking Redis (BRPOP/BLPOP/BRPOPLPUSH) on the shared `ioRedis` client.** Use
  `ioRedis.duplicate()`.
- **Inngest idempotency ids must be event-unique** — a constant id black-holes reschedules.
- **JWT** verification pins `algorithms: ['HS256']`; new tokens carry `exp` with sliding renewal.
  IDs/secrets use CSPRNG.
- **CSRF is required on cookie-authenticated mutating routes** (controllers in the
  `authenticatedController` array get it automatically). The **global validation pipe rejects unknown
  fields** (`whitelist` + `forbidNonWhitelisted`) — declare new optional fields on their DTO.
- **Two orthogonal access gates:** billing (`@CheckPolicies` + `PoliciesGuard`) → 402; RBAC
  (`@RequirePermission` + `OrgRbacGuard`) → 403. `User.isSuperAdmin` bypasses RBAC, not billing.
- **Throttling is effective** (`ThrottlerBehindProxyGuard` throttles by default, `API_LIMIT` default
  600/h). CopilotKit `/chat` is policy- and budget-gated.
- **`NOT_SECURED` is a dev-only toggle** — with `NODE_ENV=development` it relaxes helmet/HSTS and
  cookie `Secure`/`sameSite` flags. Never set it in production.
- **No secrets/PII in Sentry, error storage, or logs** — the Sentry scrubber
  (`libraries/nestjs-libraries/src/sentry/initialize.sentry.ts`) is the backstop; capture is disabled
  at source.

## Identity, RBAC & sessions

- **Identity/profile split:** `User` keeps identity/auth columns; profile fields (name, bio,
  pictureId, timezone, notification prefs) live on `UserProfile` (1:1).
- **RBAC:** `AppRole` (org-scoped; NULL org = system template; `key` =
  owner/admin/editor/member/viewer; `isSystem` = seeded). `Permission` catalog: **18 resources × 5
  actions = 90** seeded. Gating: `@RequirePermission(resource, action)` + `OrgRbacGuard`.
- **Sessions & refresh tokens:** the `Session` model backs refresh-token rotation (login creates,
  refresh rotates `tokenHash`, reuse of a rotated hash revokes, logout sets `revokedAt`).
- **Platform auth providers:** `AuthProviderConfig` is managed by the **separate administration app**;
  this repo only *reads* it (DB-first, env-bootstrap fallback). `LOCAL` auth always available unless
  `DISABLE_REGISTRATION`; OIDC SSO via `Provider.GENERIC`.

Detail: [`ARCHITECTURE.md`](./ARCHITECTURE.md) § Identity, RBAC & sessions.

## Removed legacy subsystems

Do **not** resurrect these dropped Prisma models / code paths (they reference real deleted schema, not
branding). Removed: `SocialMediaAgency`, `MessagesGroup`, `Orders`, `OrderItems`, `PayoutProblems`,
`ItemUser`, `GitHub`, `Star`, `Trending`, `TrendingLog`, `Messages` + associated enums (`OrderStatus`,
`From`) and their relations. The legacy `Role` enum and `UserOrganization.role` column were dropped —
superseded by `AppRole`-based RBAC (`UserOrganization.roleId`). The legacy `/third-party` integration
subsystem (the `@ThirdParty` decorator, `ThirdPartyManager`, the `ThirdParty` Prisma model) was
deleted — AI avatar video now lives only in the modern HeyGen Studio. The previous workflow
orchestrator was replaced by Inngest.
