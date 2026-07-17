# AGENTS.md

Guidance for AI coding agents working in this repository. **Postmill** is an open-source, AI-native
platform to schedule social media and chat posts to **36+ channels** — schedule posts, calendar view,
persisted analytics, team management, and a media library. Posts added to the calendar enter a
workflow and are published at the right time.

This file is the single in-repo guidance doc (`CLAUDE.md` imports it). It stays lean: the deep
per-feature narratives live in the maintained `docs/` site — see the **Architecture map** below and
follow the pointer for detail.

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

Apps (`apps/`):
- `backend` — NestJS REST API. Kept **thin**: controllers + module wiring. Real logic lives in
  libraries. Serves the Inngest handler at `/api/inngest`.
- `frontend` — **Next.js (App Router) + React**. Runs on port `4200`. Tailwind 3, Sentry-instrumented.
- `extension` — browser extension.
- `commands` — CLI commands.
- `sdk` — published SDK (`@postmill-ai/postmill-sdk`).

Libraries (`libraries/`):
- `nestjs-libraries` — the bulk of shared server logic, Prisma schema, and repositories. **Most
  backend logic belongs here**, not in `apps/backend`.
- `helpers` — shared utilities, including the `useFetch` hook (`@gitroom/helpers`).
- `react-shared-libraries` — shared React components.
- `providers` — the unified provider framework (kernel + one package per provider).

Docs & plans:
- `docs/` — the maintained VitePress documentation site: three audience-specific guides
  (`user-guide/`, `developer-docs/`, `operations-guide/`). **Keep it in sync with code: any new
  feature, endpoint, env var, schema model, or security invariant must be reflected there in the same
  release**, and bump the relevant page's "Verified against" note.
- `dev/` — release/implementation plans. Plans there drive a release; reconcile code against the plan,
  not the other way around.

## Unified provider framework

All provider domains (AI, Media, Storage, Short-link, Social, VPN, Content Packs, Email, Auth) resolve
through a single **`ProviderKernel`** (`libraries/providers/kernel`), one workspace package per
provider (`libraries/providers/<id>`), each version an internal module (`src/v1`, `src/v2`, …).

- A provider is addressed as `domain/providerId@version` (e.g. `ai/openai@v1`). Every config/ledger
  row carries a non-null `version` column and keeps that version until an explicit upgrade — new `v2`
  adapters cannot silently change existing behavior. Lifecycle: `preview → active → deprecated →
  retired` (deprecated rejects new writes, retired returns `410 Gone`).
- **Resolution is through `ProviderResolutionService` — the kernel is the SOLE resolution path.** The
  legacy in-memory registries and the `PROVIDER_KERNEL=legacy` kill switch were **removed**; do not
  reference them as live.
- API: `GET /providers/catalog?domain=` (**authenticated**; unknown `?domain=` → **400**);
  `GET /admin/providers/health?domain=` (super-admin) returns per-version health counters.
- Free stock providers (Unsplash, Pexels, Pixabay, GIPHY, Jamendo, Iconify) are intentionally outside
  versioning — no stored config row.

See `docs/developer-docs/provider-framework.md` and `docs/developer-docs/provider-versions.md`.

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
pnpm run build:frontend   # single app variants also exist

# Test (Vitest, per package)
pnpm run test             # helpers → nestjs-libraries → backend → frontend
vitest run --root apps/backend            # run one package's tests

# Database (Prisma 6.5.0)
pnpm run prisma-generate  # regenerate client after editing schema.prisma
pnpm run prisma-db-push   # push schema to the DB (local prototyping/reset only)
```

- **Tests run on Vitest** (`vitest run --root <pkg>`). The root `jest.config.ts` is vestigial — do
  not add jest-style configuration.
- **Lint runs from the repo root only**, via the flat `eslint.config.mjs` (eslint 8 +
  `eslint-config-next`). There is no per-package `lint` script.

## Local development performance

The stack is large; use the feature flags and lightweight commands below to keep your machine
responsive. Full details in `docs/developer-docs/local-development.md`.

### Infrastructure (Docker)

```bash
# Required services only: postgres + redis
docker compose -f docker-compose.dev.yaml up -d

# Add background jobs (Inngest dev server)
docker compose -f docker-compose.dev.yaml --profile jobs up -d

# Add pgAdmin (convenience UI)
docker compose -f docker-compose.dev.yaml --profile tools up -d
```

### Lightweight app startup

Skip heavy optional subsystems you are not working on (all flags default to **enabled**):

```bash
DEV_DISABLE_AI=true DEV_DISABLE_MCP=true DEV_DISABLE_MEDIA=true \
DEV_DISABLE_SHORTLINKS=true DEV_DISABLE_EMAIL=true pnpm run dev:minimal
```

- `DEV_DISABLE_AI` — skip AI adapter registration.
- `DEV_DISABLE_MCP` — skip Mastra/MCP/A2A server startup.
- `DEV_DISABLE_MEDIA` — skip media-generation adapter registration.
- `DEV_DISABLE_SHORTLINKS` — skip short-link adapter registration.
- `DEV_DISABLE_EMAIL` — skip email-provider adapter registration.
- `DEV_DISABLE_VIDEO` — skip video-generation adapter registration.
- `DEV_DISABLE_AGENT` — skip agent-graph services.
- `DEV_DISABLE_CRON` — skip `ScheduleModule.forRoot()`.
- `DEV_DISABLE_SENTRY` — skip Sentry initialization.
- `DEV_DISABLE_OPENTELEMETRY` — skip OpenTelemetry exporter setup.

### Backend memory cap

The backend dev script sets `--max-old-space-size=2048`. If you still hit the cap, lower it further or
disable more feature flags. Frontend dev variants: `pnpm run dev:frontend` (Turbopack),
`pnpm run dev:webpack` (fallback if Turbopack exhausts memory), `pnpm run analyze` (bundle report).

## Backend conventions (NestJS)

Pass through every layer — **no shortcuts**:

```
Controller → Service → Repository
Controller → Manager → Service → Repository   (when a manager is involved)
```

- Only repositories (`*.repository.ts` under `nestjs-libraries/src/database/prisma/<domain>/`) touch
  Prisma. Controllers/services must not call Prisma directly.
- A service should go through another domain's **service**, not reach into its repository.
- **Sanctioned exception — seeders/migration steps** under `database/seeds/**` (notably
  `BackfillService` and `RbacSeeder`) intentionally use `PrismaService` + `$transaction` directly
  (cross-table backfills/seeds) and are exempt from the repository-only rule by design.
- **Sanctioned exception — cross-domain leaf-reads:** a service may read another domain's
  **repository** directly where the owning service depends back on the caller, so routing "up" through
  the service would create a Nest DI cycle. Behaviour-neutral leaf-reads — keep them, do **not** "fix"
  them into a service call: `PostsService` → `AnalyticsRepository` / `CampaignsRepository`,
  `OrgMediaProviderSettingsService` → `@Optional() OrgAiSettingsRepository`,
  `PermissionsService` → `AiSettingsRepository`, and
  `WebhooksService` → `IntegrationRepository`. Each carries a
  `// layering: sanctioned leaf-read` comment.

See `docs/developer-docs/backend-conventions.md`.

## Frontend conventions (Next.js App Router)

- UI components live in `apps/frontend/src/components/ui`; other components in
  `apps/frontend/src/components`. Routing/pages in `apps/frontend/src/app`.
- **Check existing components before building a new one** to match the established design.

### Component / design-system policy

- **Default to the shared bespoke primitives** — the canonical building blocks:
  - **Button** → `Button` from `@gitroom/react/form/button` (native; supports `secondary`/`danger`/`loading`).
  - **Input / form fields** → `Input` from `@gitroom/react/form/input` (native, `react-hook-form`-integrated).
  - **Modals** → the bespoke `useModals()` / `ModalManager` from
    `@gitroom/frontend/components/layout/new-modal` (**not** `@mantine/modals`, which is vestigial).
- **Mantine is the sanctioned base for the few primitives where bespoke would be wasteful** and stays:
  `@mantine/core` (e.g. `Autocomplete`), `@mantine/dates` (date picker), `@mantine/hooks`. Reach for
  an existing Mantine primitive before hand-rolling one of these; do **not** rip Mantine out.
- **Write bespoke (native) only when no shared or Mantine primitive fits.** Match the design tokens;
  don't introduce a new npm UI kit (shadcn, MUI, Chakra, etc.). Don't add one-off buttons/inputs/modals
  that overlap the canonical ones.

### Error boundaries

- App Router segment boundaries: each main route group ships `error.tsx` + `not-found.tsx` rendering
  the shared `RouteError` / `RouteNotFound` (`components/errors/`).
- The `/media/*` canvas studios are wrapped at the media-layout level in `StudioErrorBoundary`
  (`components/media-tools/studio-error-boundary.tsx`). Reuse this pattern for new canvas tools rather
  than adding ad-hoc try/catch.

### Data fetching — SWR via `useFetch`

Always fetch with **SWR** through the `useFetch` hook from
`libraries/helpers/src/utils/custom.fetch.tsx`. Each SWR call must be its **own hook** and comply with
`react-hooks/rules-of-hooks`. **Never** add `// eslint-disable-next-line` to a hook.

```tsx
// Valid — one hook per resource
const useCommunity = () => useSWR(/* ... */);
```

### Styling — Tailwind 3

Before writing any component, look at `apps/frontend/src/app/colors.scss`,
`apps/frontend/src/app/global.scss`, and `apps/frontend/tailwind.config.cjs`. All `--color-custom*`
variables are **deprecated** — do not use them.

### Dashboard

The `/dashboard` page is the app's primary composition surface. New widgets follow the existing
pattern: backend aggregation in `dashboard.service.ts` (not the controller); consume `/dashboard/*`
via dedicated `use*` hooks in `apps/frontend/src/components/dashboard/hooks/`; wrap every widget in
`SectionCard` with a stable `id` and optional RBAC `permission` prop; visibility via `useDashboardPrefs`.

See `docs/developer-docs/frontend-conventions.md` and `docs/developer-docs/dashboard.md`.

## Database

The schema is authored in `libraries/nestjs-libraries/src/database/prisma/schema.prisma`, and changes
are applied through **committed Prisma migrations** (`migrations/` next to the schema, from the
`0_init` baseline). The canonical apply path is **`prisma migrate deploy`** — what CI, the backend
boot, and production use; **`db push` is local-prototyping/reset only** (never the apply path for a
shared/production DB). Because migrations run against the live production DB:

- Add columns as **nullable or defaulted**; a new required column without a default breaks the apply.
- Renames/drops are destructive — provide a manual backfill / expand-contract plan (contract step in a
  later migration), and pass `ALLOW_DESTRUCTIVE_SCHEMA=true` to clear the destructive guard.
- Run `pnpm run prisma-generate` after schema edits to keep the client in sync.

**Schema-change workflow:** edit schema → `pnpm run prisma-migrate-dev` (authors + commits the
migration) → `pnpm run prisma-schema-diff` → `pnpm run prisma-schema-check` (destructive guard) → apply
elsewhere via `pnpm run prisma-migrate-deploy`. **CI drift gate (`test.yml`):** `migrate deploy` applies
the committed migrations to an empty CI DB, then `prisma migrate diff … --exit-code` must exit 0 — a
schema edit committed **without** a matching migration fails the job. Full details in
`docs/developer-docs/database.md`; rollback in `docs/operations-guide/schema-rollback.md`.

## Channel credentials & VPN egress

Channel (social) OAuth-app credentials resolve along **two paths**, "click-connect primary, keys as
fallback":

1. **Per-org `OrgProviderConfiguration`** (Settings → Channels) — named credential sets encrypted at
   rest via `EncryptionService` (AES-GCM). This is the **override**: an org's own app always wins.
2. **Platform OAuth app from deployment env** (`channel-env-credentials.ts`) — when the operator sets a
   provider's app keys in the environment, every org gets one-click "Connect" with no key entry.
   Resolution is **live, per-request, presence-based, and never persisted to a tenant row.**

Resolution funnels through `IntegrationManager.getClientInformation(integration, orgId, configId?)`.
This env path is **channels only** — the operator owns the OAuth apps (the normal multi-tenant model).
**AI, short-link, and other provider credentials do NOT get an env fallback** (see landmines).

A channel config can also opt into routing all of its outbound posting through a **VPN region's proxy**
(SOCKS5 / HTTP-CONNECT only). See `docs/developer-docs/integrations.md`.

## Architecture map

The deep per-subsystem detail lives in `docs/`. Follow the pointer rather than duplicating it here.

| Subsystem | What it is | Docs |
|---|---|---|
| Provider framework | Kernel, per-provider packages, version lifecycle | `docs/developer-docs/provider-framework.md`, `docs/developer-docs/provider-versions.md` |
| Background jobs (Inngest) | Cron + event functions; publish, analytics, media, digests | `docs/operations-guide/inngest-and-cron.md` |
| Video rendering | Local video compute queue + optional Podman workers | `docs/operations-guide/video-rendering.md` |
| AI providers / adapters | 25 providers (BYOK), facade, governance, RAG | `docs/developer-docs/ai-architecture.md`, `docs/developer-docs/adding-an-ai-adapter.md` |
| Agent / MCP | Mastra chat agent + LangGraph generator; MCP entrypoints | `docs/developer-docs/agent-architecture.md`, `docs/developer-docs/mcp.md` |
| Analytics | Persisted daily snapshots, rollup/retention, best-time, recommendations | `docs/developer-docs/analytics-api.md` |
| Data model / schema | Prisma models, migrations | `docs/developer-docs/data-model.md`, `docs/developer-docs/database.md` |
| Webhooks | Event dispatch (SSRF-safe) | `docs/developer-docs/webhooks.md` |
| Public API / SDK | REST public API + `@postmill-ai/postmill-sdk` | `docs/developer-docs/public-api.md`, `docs/developer-docs/sdk.md` |
| Media studios / Designer | 46 media tools — Designer (Konva) + AI Designer + 38 provider studios + 6 stock browsers | `docs/user-guide/media/index.md`, `docs/developer-docs/designer.md` |
| Campaigns | Campaign Hub — tagged items, UTM, approvals, goals, share reports, discussion | `docs/user-guide/campaigns.md` |
| RBAC / team | Roles, permission catalog, sessions | `docs/user-guide/team-and-roles.md` |
| Subscriptions / billing | Plans, metering | `docs/operations-guide/subscriptions.md` |
| Security invariants | SSRF, encryption, CSRF, throttling | `docs/operations-guide/security.md` |
| Glossary | Terminology | `docs/developer-docs/glossary.md` |

### Numbers stated once (do not let them drift)

- **AI providers: 25** (13 direct + 12 hubs/gateways), BYOK, no env fallback.
- **Media tools: 46** = Designer + AI Designer + **38 provider studios** + **6 stock browsers**.
- **Channels: 36+.**
- **Background jobs: Inngest** (the previous workflow orchestrator was removed — there is **no
  `while(true)` poll loop and no `continueAsNew`**).
- **Notification categories: 10** — in the code's declared order (`notification-preference.dto.ts`
  `NOTIFICATION_CATEGORIES`): `post_published`, `post_failed`, `channels`, `comments`, `budget`,
  `media`, `announcements`, `streak`, `agent`, `analytics`. The set is hardcoded in three lockstep
  places (DTO, `DEFAULT_CATEGORY_TOGGLES`, the frontend panel); changing it is code-only (no schema
  migration). `NotificationService` is the **single chokepoint** for user-facing email + in-app/push —
  do **not** call `EmailService` directly from feature code. See `docs/user-guide/notifications.md`.

## Security invariants (do not break)

Condensed "don't break this" set. Detail in `docs/operations-guide/security.md`.

- **No env-`OPENAI_API_KEY` (or any env AI-key) fallback.** No active AI provider for an org ⇒ AI is
  **off** for that org across all four surfaces (utility, generator, agent, copilot). Never reintroduce
  an env-key fallback. (AI keys live in `AIOrgProviderConfig`, encrypted at rest.)
- **The `ProviderKernel` is the sole resolution path.** The legacy in-memory registries and the
  `PROVIDER_KERNEL=legacy` kill switch were **removed** — do not call them as live.
- **All user-influenced outbound HTTP goes through `safeFetch`** (`dtos/webhooks/safe.fetch.ts`):
  `isSafePublicHttpsUrl` + `ssrfSafeDispatcher` + manual per-hop redirect re-validation. No bare
  `fetch(userUrl)` — DTO validation alone doesn't survive DNS rebinding or 30x redirects.
  `SSRF_ALLOWED_PRIVATE_CIDRS` is the opt-in for self-hosted instances.
- **Secrets at rest are encrypted via `EncryptionService`** (AES-GCM, `v2:` prefix). **Single-key
  model:** one deployment-wide key encrypts every secret — there is **no per-org crypto key**.
  "Org-scoped" means DB-column-scoped, not cryptographically isolated; cross-org isolation is enforced
  by query scoping. Keep per-org reads on `EncryptionService` and global reads on
  `AuthService.fixedEncryption` (same key behind two routes). `ENCRYPTION_KEY` is optional and falls
  back to deriving from `JWT_SECRET`. Never store secrets plaintext.
- **Never run blocking Redis (BRPOP/BLPOP/BRPOPLPUSH) on the shared `ioRedis` client** — they stall
  every pipelined command, including the per-request throttler check. Use `ioRedis.duplicate()`.
- **Inngest idempotency ids must be event-unique** — a constant idempotency id black-holes reschedules.
- **JWT** verification pins `algorithms: ['HS256']`; new tokens carry `exp` with sliding renewal
  (legacy exp-less tokens still verify). IDs/secrets use CSPRNG.
- **CSRF is required on cookie-authenticated mutating routes**; header/API-key clients are unaffected.
  The **global validation pipe rejects unknown fields** (`whitelist` + `forbidNonWhitelisted`) — declare
  new optional fields on their DTO.
- **Throttling is effective** (`ThrottlerBehindProxyGuard` throttles by default). CopilotKit `/chat` is
  policy- and budget-gated.
- **`NOT_SECURED` is the universal dev-toggle** — HSTS, helmet, CSRF, and the CopilotKit policy gate all
  bypass when set. Dev/local only.
- **No secrets/PII in Sentry, error storage, or logs** — the Sentry scrubber (`initialize.sentry.ts`)
  is the backstop; capture is disabled at source.

## Identity, RBAC & sessions

- **Identity/profile split:** `User` keeps identity/auth columns (email, password, providerName,
  providerId, isSuperAdmin, activated, …). Profile fields (name, bio, pictureId, timezone, notification
  prefs) live on `UserProfile` (1:1).
- **RBAC:** `AppRole` (org-scoped; NULL org = system template; `key` = stable machine name
  owner/admin/editor/member/viewer; `isSystem` = seeded, non-deletable). `Permission` is the
  fine-grained `(resource, action)` catalog — **18 resources × 5 actions = 90** seeded permissions.
  `AppRolePermission` joins them. Gating: `@RequirePermission(resource, action)` + `OrgRbacGuard`.
- **Two orthogonal access gates:** the **billing gate** (`@CheckPolicies` + `PoliciesGuard`) → HTTP 402
  ("has this org paid?"); the **RBAC gate** (`@RequirePermission` + `OrgRbacGuard`) → HTTP 403 ("is this
  member allowed?"). A route may carry both. `User.isSuperAdmin` bypasses RBAC (not billing).
- **Sessions & refresh tokens:** the `Session` model backs refresh-token rotation (login creates,
  refresh rotates `tokenHash`, reuse of a rotated hash revokes, logout sets `revokedAt`).
  `/user/sessions` lists active devices. Access token is HS256 with sliding renewal.
- **Platform admin & auth providers:** `AuthProviderConfig` stores platform-wide login-provider configs
  (encrypted at rest), managed by the **separate administration app** (a distinct repo). This repo only
  *reads* `AuthProviderConfig` (DB-first, env-bootstrap fallback) and ships no `/admin` frontend or
  login-provider write API. `LOCAL` auth is always available unless
  `DISABLE_REGISTRATION` is set; OIDC SSO via `Provider.GENERIC`.

See `docs/user-guide/team-and-roles.md` and `docs/user-guide/sessions.md`.

## Removed legacy subsystems

Do **not** resurrect these dropped Prisma models / code paths (they reference real deleted schema, not
branding). Removed: `SocialMediaAgency`, `MessagesGroup`, `Orders`, `OrderItems`, `PayoutProblems`,
`ItemUser`, `GitHub`, `Star`, `Trending`, `TrendingLog`, `Messages` + associated enums (`OrderStatus`,
`From`) and their relations. The legacy `Role` enum and `UserOrganization.role` column were dropped —
superseded by `AppRole`-based RBAC (`UserOrganization.roleId`). The legacy `/third-party` integration
subsystem (the `@ThirdParty` decorator, `ThirdPartyManager`, the `ThirdParty` Prisma model) was
deleted — AI avatar video now lives only in the modern HeyGen Studio. The previous workflow
orchestrator was replaced by Inngest.
