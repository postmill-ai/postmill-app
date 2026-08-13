# The libraries map: where code lives and what to import

How the Postmill monorepo's shared packages are laid out, what each contains, and where new code
belongs. Sibling docs: `agents/backend.md`, `agents/frontend.md`, `agents/ui-standards.md`,
`agents/providers/overview.md`, root `ARCHITECTURE.md`.

## How imports resolve (read this first)

Cross-package imports do **not** resolve through each workspace's `package.json` `exports`/`main`.
They resolve through the `paths` map in **`tsconfig.base.json`** (repo root). There is no built
artifact in the loop during dev — you import straight into another workspace's `src/`.

| Import alias | Resolves to | Notes |
|---|---|---|
| `@postmill-ai/nestjs-libraries/*` | `libraries/nestjs-libraries/src/*` | Bulk of all server logic. |
| `@postmill-ai/backend/*` | `apps/backend/src/*` | Thin NestJS app shell. |
| `@postmill-ai/frontend/*` | `apps/frontend/src/*` | Next.js app. |
| `@postmill-ai/helpers/*` | `libraries/helpers/src/*` | Framework-agnostic shared utils. |
| `@postmill-ai/react/*` | `libraries/react-shared-libraries/src/*` | **Alias is `@postmill-ai/react`, NOT the package name** (`@postmill-ai/react-shared-libraries`). |
| `@postmill-ai/provider-kernel` (+ `/*`) | `libraries/providers/kernel/src` | Provider kernel. |
| `@postmill-ai/provider-<id>` (+ `/*`) | `libraries/providers/<id>/src` | One alias per provider, e.g. `@postmill-ai/provider-openai` → `libraries/providers/openai/src`. |
| `@postmill-ai/extension/*` | `apps/extension/src/*` | Browser extension. |

Example: `import { PrismaService } from '@postmill-ai/nestjs-libraries/database/prisma/prisma.service';`
— the segment after the alias is a real path under `libraries/nestjs-libraries/src/`. When you add a
new file, no export registration is needed; the path alias just works.

## `libraries/nestjs-libraries` (package `@postmill-ai/nestjs-libraries`)

The bulk of all server logic. `apps/backend` is kept thin (controllers + wiring); real logic lives
here. Tour of `libraries/nestjs-libraries/src/`:

| Directory | Purpose | Put code here when… |
|---|---|---|
| `database/prisma/` | `schema.prisma` + committed `migrations/` + `prisma.service.ts` (exports `PrismaService`, `PrismaRepository<T>`, `PrismaTransaction`) + `database.module.ts` | Schema change (edit schema → `pnpm run prisma-migrate-dev`), or touching the base Prisma classes. |
| `database/prisma/<domain>/` | 39 domain dirs (`posts`, `users`, `integrations`, `campaigns`, `analytics`, `media`, `roles`, …), each holding that domain's `*.repository.ts` (only layer that touches Prisma) and usually `*.service.ts` | Any new DB access — always via a repository; controllers/services never call Prisma directly. |
| `database/seeds/` | `RbacSeeder`, `BackfillService`, `demo-seeder.ts`, `featured-provider.seeder.ts` — sanctioned to use `PrismaService` + `$transaction` directly (cross-table seeds/backfills) | Writing a seed or a data backfill. |
| `dtos/<domain>/` | All class-validator DTOs, one dir per domain. `dtos/webhooks/safe.fetch.ts` exports **`safeFetch`** — the mandatory SSRF-safe outbound HTTP wrapper | New request/response body shape. Global pipe has `whitelist` + `forbidNonWhitelisted` — undeclared fields are rejected. |
| `services/` | Cross-domain infra services: `email.service.ts`, `stripe.service.ts`, `exception.filter.ts`, `codes.service.ts`, `make.is.ts` | Infra that has no single domain owner. |
| `integrations/` | `integration.manager.ts` — **sole funnel** `getClientInformation(integration, orgId?, configId?)` for channel OAuth credentials; `channel-env-credentials.ts` (env-fallback resolution); `social/` + `social.abstract.ts` (channel posting abstraction) | Channel credential resolution or posting-behavior changes. |
| `inngest/` | `inngest.client.ts` / `inngest.module.ts` / `inngest.service.ts`, `inngest-run.service.ts`, `activities/` (job logic), `errors/` | New background-job logic goes in `activities/`; function definitions live in `apps/backend/src/inngest/functions`. Idempotency ids must be event-unique. |
| `agent/` | LangGraph generator agent (`agent.graph.service.ts` — `StateGraph`, `agent.graph.insert.service.ts`, topics/categories) | Changes to the AI content-generation graph. |
| `chat/` | Mastra chat agent + MCP: `mastra.service.ts`, `agents/`, `tools/`, `content-pipeline/`, `start.mcp.ts` (MCP entrypoint) | Chat-agent tools, MCP surface. |
| `ai/` | `ai-model.provider.ts` (AI facade), `ai-settings.manager.ts`, `governance/`, `rag/`, `defaults/`, `ai-provider.interface.ts` | AI-call policy/facade changes. No env AI-key fallback — no active provider ⇒ AI off for that org. |
| `ai-designer/` | AI Designer pipeline: `conductor/` (incl. the bounded beauty gate — `MAX_QUALITY_PASSES` critique→fix passes; a variant still flagged for `aesthetic_quality`/`craft_polish`/`reference_fidelity` is held back unless it is the only result), `agent-mesh/`, `agents/`, `skills/`, `guards/`, `styles/` (style preset registry — fonts must come from the curated catalog in `media/design-render/font-loader.service.ts`), `design-language/` (effect/treatment/mask/decor recipe catalogs — prompt text is GENERATED from the tables, so new recipes like `vignette` appear automatically), `util/` (per-aspect helpers). Plan craft fields (slot `style.letterSpacing`/`lineHeight`/`opacity`/shadow-object, slot `scrim`/`treatmentStrength`, slot `geometry` — reference-measured bands stamped by `util/apply-reference-geometry.ts`, never LLM-authored) live in `ai-designer.schemas.ts` + `ai-designer.types.ts` — extend both in lockstep. **Reference runs close the visual loop**: the critic attaches the downscaled reference image next to the render in every critique (`referenceFileIds` on the payload; region-named fidelity checklist), the interpreter also emits a measured `brief.referenceLayout` (cached with `referenceCueFileIds` — never re-rolled while the files are unchanged), a critic `recompose` fix re-enters compose once per variant with the same copy/assets, `style.badgeStyle` fixes re-emit the plate through `agents/composer/badge-plate.ts`, and delivery is best-of-N: survivors are ranked against the reference in one `compare-request` and only the winner ships (losers stay saved designs). **Copy quality is enforced UPSTREAM, before the plan card** (`agents/art-director/copy-grounding.ts`: inverse claim-lint against the brief corpus — invented urgency/jargon is repair-retried then stripped; CTA command lint with per-brief defaults from `skills/copy-rules.ts`); plan copy stays locked after approval and the critic only VERIFIES the render used it. Plans carry art-direction floors (`background` required; imageless plans need ≥1 decor; per-skill `artDirection` catalogs render into the prompt via `getArtDirection`), the critic judges `plan_conformance` against the serialized plan spec (hold-back criterion; findings always carry a criterion — missing ones default to `aesthetic_quality`), `briefIntent` rides every critique pass (primary, expansion, revise), and `assetNeeds.kind` (`photo`/`illustration`/`icon`/`vector`) routes the asset agent to the illustrator prompt, Iconify search, or stock vectors — asset-resolved icons feed `resolveIconSlots` without a literal Iconify role. | AI Designer orchestration work. |
| `analytics/` | Persisted analytics: aggregation, overview/detail/insights/export/share services, anomaly detection | Analytics computation or rollup changes. |
| `media/` | `media.module.ts` + per-studio subdirs (`heygen`, `replicate-studio`, `deepgram`, `slide`, `caption`, `stock`, `stream`, `studio`, `design-render`, `designer-doc`), `media-provider-adapter.interface.ts` | Media-generation studio backend. |
| `providers/` | `providers.module.ts` (re-exports `PROVIDER_KERNEL` token, defined in `provider-kernel.token.ts`), `provider-resolution.service.ts` — **sole provider resolution path**; `provider-catalog.service.ts`, `provider-health.service.ts` | Wiring providers into DI. Do not resolve providers anywhere else. |
| `encryption/` | `EncryptionService` — thin NestJS delegate to `AuthService.fixedEncryption`/`fixedDecryption` (helpers); the AES-256-GCM + `v2:` prefix implementation lives in `libraries/helpers/src/auth/auth.service.ts` | Never store secrets plaintext; always inject this service. |
| `emails/` | `email-adapter.interface.ts` (type re-export: kernel's `EmailCapability` re-exported as legacy name `EmailAdapter`), `email-adapter.registry.ts` | Email sending abstractions. Feature code should go through `NotificationService`, not `EmailService`, for user-facing email. |
| `feature-flags/` | `FeatureFlagsService` — dev-toggle map: `DEV_DISABLE_AI`, `DEV_DISABLE_MCP`, `DEV_DISABLE_MEDIA`, `DEV_DISABLE_SHORTLINKS`, `DEV_DISABLE_EMAIL`, `DEV_DISABLE_VIDEO`, `DEV_DISABLE_AGENT`, `DEV_DISABLE_SENTRY`, `DEV_DISABLE_OPENTELEMETRY`, `DEV_DISABLE_CRON` | Adding a new dev-startup kill switch. |
| `redis/` | `redis.service.ts` (shared `ioRedis` client), `redis-lock.ts` | Redis access. **Never run blocking commands (BRPOP/BLPOP/…) on the shared client** — use `ioRedis.duplicate()`. |
| `short-linking/` | `short.link.service.ts`, `short-link-oauth.service.ts`, interface + error/filter | Short-link domain logic. |
| `throttler/` | `throttler.provider.ts` — exports `ThrottlerBehindProxyGuard` (throttles by default, keyed behind proxy) | Rate-limit changes. |
| `sentry/` + `otel/` | `initialize.sentry.ts` (init + **PII scrubber** — the no-secrets-in-Sentry backstop), `sentry.exception.ts`; `initialize.otel.ts` | Telemetry init changes. No secrets/PII in Sentry or logs. |
| `upload/` | `upload.module.ts`, `custom.upload.validation.ts`, `upload-limits.ts`, `data.url.ts` | File-upload handling/limits. |
| `user/` | Request decorators: `user.from.request.ts` (`@UserFromRequest`), `org.from.request.ts` (`@OrgFromRequest`), `user.agent.ts`, `track.enum.ts` | Reading authenticated user/org in a controller — use these, don't re-parse. |
| `vpn/` | `vpn-dispatcher.factory.ts` / `vpn-dispatcher.service.ts` (SOCKS5/HTTP-CONNECT egress), `org-vpn-config.service.ts`, `vpn.context.ts` | VPN/proxy egress for channel posting. |
| `auth/` | `auth-context.resolver.ts` | Auth-context resolution. |
| `security/` | `return-url.validator.ts` | Small security validators. |
| `pipes/` | `parse-cuid.pipe.ts` | Nest pipes. |
| `errors/` | `post-validation.exception.ts` | Shared exception types. |
| `track/` | `track.service.ts` (event tracking) | Product-analytics events. |
| `types/` | `provider-config.types.ts` | Shared server-side types. |
| `utils/` | `concurrency.ts`, `capped-stream.ts`, `client-ip.ts`, `account-fingerprint.ts` | Server-only utilities. |
| `testing/` | `test-db.ts` — test-database harness (used by `*.spec.ts`) | Writing DB-backed tests. |
| `openai/` | `openai.service.ts`, `extract.content.service.ts` — legacy OpenAI helpers kept for specific flows; new AI work goes through `ai/` + the provider kernel | Rarely; prefer the kernel. |
| `brands/`, `dashboard/`, `newsletter/` | Domain services for brands, dashboard aggregation (`dashboard.service.ts` pattern), newsletter | Domain work in that area. |

Layering, always: `Controller → Service → Repository` (a `Manager` may sit between controller and
service). Cross-domain calls go through the other domain's **service**, not its repository (a few
sanctioned leaf-read exceptions exist, marked `// layering: sanctioned leaf-read`). See
`agents/backend.md`.

## `libraries/helpers` (package `@postmill-ai/helpers`)

Framework-agnostic utilities used by **both** frontend and backend. Key files under
`libraries/helpers/src/`:

| Path | Exports / purpose |
|---|---|
| `utils/custom.fetch.tsx` | **`useFetch`** — THE mandated data-fetch hook (SWR wrapper). Every frontend SWR call goes through this, one hook per resource. Also `FetchWrapperComponent`. |
| `utils/custom.fetch.func.ts` | Non-hook fetch helper used by `useFetch`. |
| `utils/internal.fetch.ts` | `internalFetch` — server-internal fetch helper. |
| `utils/csrf.header.ts` | `csrfHeader()` — attaches the `x-csrf-token` header; required on cookie-authenticated mutations. |
| `auth/auth.service.ts` | Static `AuthService`: `signJWT`/`verifyJWT` (HS256), `fixedEncryption`/`fixedDecryption` (AES-256-GCM, `v2:` prefix — the global encryption route, same key as `EncryptionService`), `fixedEncryptionDeterministic`, plus legacy IV helpers. |
| `decorators/plug.decorator.ts` + `decorators/post.plug.ts` | `@Plug` / `@PostPlug` — decorate provider methods that run before/after posting. |
| `configuration/configuration.checker.ts` | `ConfigurationChecker` — fail-fast env validation at boot. |
| `swagger/load.swagger.ts` | `loadSwagger(app)` — OpenAPI setup. |
| `subdomain/` | `subdomain.management.ts`, `all.two.level.subdomain.ts` — subdomain helpers. |
| `upload-limits.client.ts` | Client-side upload-limit constants. |
| `utils/` (rest) | `is.dev.ts`, `timer.ts`, `strip.html.validation.ts`, `sanitize.post.content.ts`, `count.length.ts`, `utm.saver.tsx`, `valid.images.ts`, `valid.url.path.ts`, `strip.tags.ts`, `strip.links.ts`, `remove.markdown.ts`, `html.to.text.ts`, `read.or.fetch.ts`, `posts.list.minify.ts`, `use.fire.events.ts`, `use.wait.for.class.tsx`, `linkedin.company.prevent.remove.ts`, `has.extension.ts`, `is.general.server.side.ts` |

Rule of thumb: if a helper is needed by both frontend and backend (or is framework-free), it goes
here; server-only helpers go in `nestjs-libraries/src/utils/`, React-only in
`react-shared-libraries`.

## `libraries/react-shared-libraries` (package `@postmill-ai/react-shared-libraries`, imported as `@postmill-ai/react/*`)

Shared React components/hooks for the frontend. Usage rules live in `agents/ui-standards.md`; this
is the inventory (`libraries/react-shared-libraries/src/`):

| Path | Contents |
|---|---|
| `form/` | **Canonical form primitives**: `button.tsx` (`Button` — supports `secondary`/`danger`/`loading`), `input.tsx` (`Input`, react-hook-form-integrated), `select.tsx`, `custom.select.tsx`, `checkbox.tsx`, `slider.tsx`, `textarea.tsx`, `color.picker.tsx`, plus `canonical.tsx`, `total.tsx`. Always import these instead of hand-rolling. |
| `helpers/` | `delete.dialog.tsx`, `safe.image.tsx`, `image.with.fallback.tsx`, `uppy.upload.ts`, `mantine.wrapper.tsx`, `use.track.tsx`, `utc.date.render.tsx`, `variable.context.tsx`, `use.is.visible.tsx`, `use.media.directory.ts`, `use.prevent.window.unload.tsx`, `use.state.callback.ts`, `posthog.tsx`, `video.frame.tsx`, `video.or.image.tsx`, `is.general.tsx`, `testomonials.tsx` (filename typo is real). |
| `toaster/toaster.tsx` | `Toaster` + `useToaster` — the toast surface. |
| `translation/` | i18next setup: `i18next.ts`, `i18n.config.ts`, `locales/`, `translated-label.tsx`, `get.translation.service.backend.ts`, and `get.transation.service.client.ts` (**filename typo "transation" is real** — import it as spelled). |
| `sentry/` | Client/server Sentry init: `initialize.sentry.client.ts`, `initialize.sentry.next.basic.ts`, `initialize.sentry.server.ts`. |

## `libraries/providers`

The unified provider framework: `kernel/` (the `ProviderKernel`, imported as
`@postmill-ai/provider-kernel`) plus ~150 sibling packages, one per provider
(`libraries/providers/<id>/`, imported as `@postmill-ai/provider-<id>`), each with versioned
internal modules (`src/v1`, `src/v2`, …). Every provider resolves through the kernel via
`ProviderResolutionService` in `nestjs-libraries/src/providers/` — there is no other resolution
path. Full mechanics, versioning lifecycle, and how to add a provider: `agents/providers/overview.md`.

## `apps/*` quick map

- **`apps/backend`** (`postmill-backend`) — thin NestJS REST API shell. `src/api/routes/` holds all
  REST controllers (112 files; `src/api/controllers/` only has the Inngest serve controller);
  `src/api/api.module.ts` wires them via its `imports`/`controllers`/`providers` arrays;
  `src/inngest/functions/` defines the Inngest functions (logic in nestjs-libraries activities);
  `src/public-api/` is the public REST API module; `src/providers.generated.ts` +
  `src/providers.bootstrap.ts` (+ `register-provider-paths.ts`) register provider packages;
  `main.ts` bootstraps. Detail: `agents/backend.md`.
- **`apps/frontend`** (`postmill-frontend`) — Next.js App Router app on port 4200.
  Detail: `agents/frontend.md`; component/design rules: `agents/ui-standards.md`.
- **`apps/commands`** (`postmill-command`) — operator CLI: NestJS `nestjs-command` runner
  (`src/main.ts` + `src/command.module.ts`) with tasks in `src/tasks/`: `seed-demo.ts`,
  `refresh.tokens.ts`, `configuration.ts`, `agent.run.ts`, `backfill-provider-versions.ts`,
  `backfill-design-thumbnails.ts`. The command module imports the same `@Global` module set
  as the backend app module (minus `ChatModule`) plus `ProvidersBootstrap` — without those,
  `DatabaseModule` services and kernel resolution (`storage/local@v1`, …) fail standalone.
  **Run a command against the COMPILED dist with the path register** — the kernel and provider
  packages' `main` points at raw `.ts`, which Node's ESM loader refuses (same trap
  `apps/backend/dev.cjs` documents):
  `npx nest build && node -r ./register-paths.cjs ./dist/apps/commands/src/main.js <command> [args]`
  (from `apps/commands`, with `dotenv -e ../../.env` and a localhost `DATABASE_URL` for host runs).
  Touch when adding an operator/maintenance command; **never** put request-path logic here.
- **`apps/extension`** (`postmill-extension`) — Vite + `@crxjs` browser extension for cookie-based
  platform auth. `src/background.ts` is the service worker; `src/providers/` holds the per-site
  cookie providers (`providers/list/`, e.g. `skool.provider.ts`), `cookie-provider.interface.ts`,
  and `provider.registry.ts`. Touch only for platform cookie capture.
- **`apps/sdk`** (`@postmill-ai/postmill-sdk`) — the published Node SDK over the public API
  (`src/index.ts`, `src/types.ts`). Changes here are public API surface — version accordingly.

## Dependency placement

- Root `package.json` = shared tooling and genuinely cross-cutting packages only.
- Feature-specific deps go in the owning workspace's own `package.json` (`apps/*` or
  `libraries/*`). Do not add a backend-only or frontend-only package to the root manifest.
- **pnpm only** — never npm/yarn. `pnpm install` also runs `prisma generate` via postinstall.

## Where does new code go?

| You are adding… | Put it in… |
|---|---|
| New REST endpoint | Controller in `apps/backend/src/api/routes/` + wire in `src/api/api.module.ts`; logic in `libraries/nestjs-libraries/src/database/prisma/<domain>/` (service/repository) or the relevant nestjs-libraries dir |
| New DB access (query/model) | `libraries/nestjs-libraries/src/database/prisma/<domain>/` — repository only touches Prisma; schema change → `schema.prisma` + `pnpm run prisma-migrate-dev` |
| New background job | Logic in `libraries/nestjs-libraries/src/inngest/activities/`; function definition in `apps/backend/src/inngest/functions/` (event-unique idempotency id) |
| New provider (any domain) | `libraries/providers/<id>/` (+ alias already exists per id; see `agents/providers/overview.md`); resolve only through the kernel |
| New shared React primitive | `libraries/react-shared-libraries/src/form/` or `helpers/` — **rare**: check `agents/ui-standards.md` first; an existing canonical or Mantine primitive usually fits |
| New shared util (frontend + backend) | `libraries/helpers/src/utils/` (server-only → `nestjs-libraries/src/utils/`) |
| New CLI / maintenance op | `apps/commands/src/tasks/` |
| New DTO | `libraries/nestjs-libraries/src/dtos/<domain>/` (global pipe rejects undeclared fields) |
