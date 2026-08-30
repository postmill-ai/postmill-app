# Testing & lint

Vitest per package (vitest 4, `@vitest/ui ^4.1.0` at root). Specs are **co-located** with
source: `*.spec.ts` / `*.test.ts` (unit) and `*.int-spec.ts` (integration). There is **no
root `vitest.config.ts`** — each package has its own. The old root `jest.config.ts` has been
deleted; do not resurrect it or add jest-style configuration.

## Root scripts (`package.json`)

| Script | What it runs |
|---|---|
| `pnpm run test` | `vitest run --root` over **8 packages, in order**: `libraries/helpers` → `libraries/providers` → `libraries/nestjs-libraries` → `apps/backend` → `apps/frontend` → `apps/commands` → `apps/sdk` → `apps/extension`. **No `--coverage`** — thresholds are not enforced by this script. |
| `pnpm run test:coverage` | Same roots minus sdk/extension, each with `--coverage` (enforces the per-config thresholds). |
| `pnpm run test:int` | `vitest run --root libraries/nestjs-libraries --config vitest-integration.config.ts` — DB integration specs against real Postgres. |

Run one package: `vitest run --root <pkg>` (e.g. `vitest run --root apps/backend`).

## Per-package config conventions

| Package | Config | Key settings |
|---|---|---|
| `libraries/helpers` | `vitest.config.ts` | node env; include `src/**/*.spec.ts`, `src/**/*.test.ts`. |
| `libraries/providers` | `vitest.config.ts` | Aliases redirect every `@postmill-ai/provider-*` package to its `src` (tests run current source, not stale `node_modules`). Include `*/src/**/*.{spec,test,int-spec}.ts`. Coverage: v8, `all: false` (only instrument files tests actually load — otherwise 70+ untested adapters report 0% and sink the floor); include = `kernel/src/**` + the 8 B4 media adapters; thresholds **statements 75 / lines 70**. HTML report output under `libraries/providers/coverage/`. |
| `libraries/nestjs-libraries` | `vitest.config.ts` | `pool: 'threads'`, **`maxWorkers: 1`**, `isolate: true`, `setupFiles: ['./vitest.setup.ts']`. Include `src/**/*.spec.ts` + `src/**/*.eval.ts`. Coverage ratchet floors over the AI/integrations/analytics surface: **statements 72 / branches 62.5 / functions 72 / lines 73** — floors at *measured* coverage so regressions fail CI, not aspirational targets. |
| `libraries/nestjs-libraries` (integration) | `vitest-integration.config.ts` | Include `src/**/*.int-spec.ts` (does not match the unit globs, so unit runs skip these). `globalSetup: ['./vitest-integration.global.ts']`, **`maxWorkers: 1`**, **no setupFiles** — integration specs hit a real DB and must not load the unit mocks. |
| `apps/backend` | `vitest.config.ts` | **`maxWorkers: 1`**, `isolate: true` — each spec gets a fresh module registry so conflicting `vi.mock(...)` stubs (redis, Stripe) can't leak across files (order-independence). Coverage is **per-file thresholds** on individual controllers (e.g. `analytics.v2.controller.ts` 90/90/75/90; `auth.controller.ts` 35/15/20/35) because vitest 4 applies aggregate global thresholds to every included file. |
| `apps/frontend` | `vitest.config.ts` | jsdom + `@vitejs/plugin-react`; include is an explicit allowlist of component dirs (`analytics-v2`, `launches`, `dashboard`, `settings/**`, `campaigns`, `composer`, `media-tools`, `app/**`, …) — a spec outside the allowlist silently never runs. Coverage scoped to `src/components/analytics-v2/**` only: **69/62/58/69**. |
| `apps/commands`, `apps/sdk`, `apps/extension` | `vitest.config.ts` each | Same co-located spec pattern. |

**Single-thread rule**: backend and nestjs-libraries run `maxWorkers: 1`. For the
integration config the reason is the DB harness: `globalSetup` creates exactly one
throwaway Postgres database per run (named `postmill_test_${process.pid}`) and hands its
URL to workers via vitest `provide`/`inject` — parallel workers would share/collide on it.
Keep `maxWorkers: 1` when adding specs that touch the DB harness or process-wide mocks.

## DB test harness — `libraries/nestjs-libraries/src/testing/test-db.ts`

- `createTestDatabase()` → `{ url, drop }`. Connects with an admin client
  (`TEST_DATABASE_ADMIN_URL`, default `postgresql://postmill-local:postmill-local-pwd@localhost:5432/postgres`),
  `DROP DATABASE IF EXISTS ... WITH (FORCE)` then `CREATE DATABASE postmill_test_${pid}`,
  and pushes the full schema in with `pnpm exec prisma db push --skip-generate`. First call
  is slow (full push); runs once per run via `vitest-integration.global.ts`, which exposes
  the URL as `inject('dbUrl')` and drops the DB on teardown.
- `getTestPrisma(url)` → a `PrismaClient` pointed at that test DB.
- CI provides Postgres via the service container in `.github/workflows/test.yml`
  (`TEST_DATABASE_ADMIN_URL` / `DATABASE_URL` env on the `Run integration tests` step).

## Provider testing (`libraries/providers/`)

Every provider package is gated by kernel-level specs in
`libraries/providers/kernel/src/__tests__/`:

1. **Conformance** — `all-providers.conformance.spec.ts` iterates `providerModules` from
   `@postmill-ai/backend/providers.generated` and calls `runDomainConformance(domain, module, …)`
   from `kernel/src/testing/conformance.ts`. It throws (not skips) on: invalid manifest,
   domain mismatch, non-function `create()`, **network I/O during `create()`** (a throwing
   stub fetch is installed — `create()` must be pure), and missing required capability
   methods (`REQUIRED_METHODS` per domain, verified against `kernel/src/domains/<domain>.ts`).
   It also locks the base-class consolidation: migrated media adapters must extend the
   shared bearer base, migrated shortlink adapters the shared shortlink base (asserted via
   the adapter's own prototype chain, not a cross-realm `instanceof`).
2. **Metadata** — `kernel.metadata.spec.ts` registers all modules in a real `ProviderKernel`
   and checks `getMetadata` per provider, model-category completeness, and language codes.
3. **OAuth state grep-guard** — `oauth-state.guard.spec.ts` walks every
   `*/src/**/social.adapter.ts` plus `kernel/src/domains/social-families/*-base.ts` and
   enforces that the OAuth `state`/OIDC `nonce` derives from `makeOauthState()` (128-bit)
   or legacy `makeId(>=32)` — it exists because pre-fix code shipped brute-forceable
   `makeId(6)` = 24-bit states. Do not hand-roll state generation.

**Int-spec fixture convention** (`*.int-spec.ts` in provider packages): recorded fixtures,
no network. Build a stub runtime context with `makeCtx(handler)` and canned responses with
`res(body, ok, status)` from `kernel/src/testing/media-int-helpers.ts` — `ctx.fetch` records
each request (`{url, method, headers, body}`) and returns what your handler supplies; assert
on both the recorded request and the parsed result. Where a response shape is taken from
vendor docs rather than a real API key, mark it at the top of the spec with a
`// UNVERIFIED vs live key: …` comment (precedent: `vecteezy`, `envato`, `adobe-stock`,
`suno` int-specs). See `agents/providers/overview.md`.

## Frontend testing

- **SWR isolation**: component specs that render hooks/components using SWR wrap the tree in
  `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>` — fresh cache per
  test, no cross-test dedup (precedent: `apps/frontend/src/components/settings/shortlinks/shortlinks.tab.spec.tsx:110`).
- **Dashboard hooks**: each hook in `apps/frontend/src/components/dashboard/hooks/` has a
  sibling `.spec.ts` (`useDashboardSummary.spec.ts`, `useDashboardPrefs.spec.ts`, …). Hook
  specs `vi.mock` both `@postmill-ai/helpers/utils/custom.fetch` (`useFetch`) and `swr`
  rather than rendering. New dashboard hooks must follow the same pattern (see
  `agents/backend.md` for the `/dashboard/*` endpoints they consume).
- Never disable `react-hooks/rules-of-hooks` to make a test pass; each SWR call must be its
  own hook.

## E2E (`e2e/`)

Playwright (`@playwright/test 1.58.2`, separate `e2e/package.json` outside the pnpm
workspace scripts — install it standalone with `pnpm install --ignore-workspace`;
`@axe-core/playwright` for the a11y audit config). `playwright.config.ts`:
`testDir: ./tests`, `workers: 1`, `retries: 1`, `baseURL: https://app.postmill.ai`
(live deployment — E2E specs exercise the real app, not a local boot), a `setup` project
(`**/auth.setup.ts`) writing one storage state per persona (`.auth/admin.json` /
`member.json` / `free.json`); the main project is named `admin` and consumes
`.auth/admin.json` (persona-aware specs read `test.info().project.name`). The composer
entry is the header "Create new" icon-button → "New Post" menuitem → `/posts/post` —
specs open it via `tests/lib/composer.ts` (`openComposer`), not by looking for a
"Create Post" text button. A full run exceeds the default API throttle (600 req/h/IP) —
raise `API_LIMIT` for the run window and restart the backend, or expect 429-cascade
failures. Run: `cd e2e && pnpm test` (aliases: `test:headed`, `test:audit` with
`playwright.audit.config.ts`, `report`). Never run `e2e/seed-test-data.js` against the
prod deployment — it deletes the Organization row of every org `test@test.com` belongs
to; use the `seed:demo` fixtures (Solstice cast) with `E2E_MEMBER_EMAIL` /
`E2E_FREE_EMAIL` overrides instead. Add an E2E spec only for cross-page user flows that
unit/integration tests can't cover (auth flows, composer end-to-end, settings CRUD
round-trips); keep component-level behavior in vitest.

## Lint

- **One flat config at the repo root only**: `eslint.config.mjs` — **ESLint 9** (`^9.39.4`)
  with **eslint-config-next 16** (`16.2.7`) native flat configs spread directly (no
  FlatCompat). **Correction vs `AGENTS.md`, which says "eslint 8" — the installed version is 9.**
  There are **no per-package `lint` scripts**; run from the root:
  `pnpm exec eslint . --report-unused-disable-directives` (what CI runs).
- Notable rule state: `react/display-name: error`; `@typescript-eslint/no-explicit-any`,
  `no-unused-vars`, `ban-ts-comment` are `off` (tracked mass-refactor debt — do not
  "helpfully" re-enable); `react-hooks/preserve-manual-memoization: warn`.
- **jsx-a11y**: recommended ruleset scoped to `apps/frontend/src/**/*.{js,jsx,ts,tsx}`;
  seven high-volume rules are `warn` (visible, non-blocking): `no-static-element-interactions`,
  `click-events-have-key-events`, `media-has-caption`, `no-autofocus`,
  `label-has-associated-control`, `no-noninteractive-element-interactions`,
  `no-noninteractive-tabindex`. New code should not add to these warning counts.
- **i18next/no-literal-string**: opt-in — `off` by default, `warn` when `I18N_LINT=1`
  (e.g. `I18N_LINT=1 pnpm exec eslint apps/frontend/src`). Off by default because warn-level
  output would flood the SARIF code-scanning gate (~13k alerts).
- **CI**: tests + lint live in `.github/workflows/test.yml` (workflow `Test`; job `lint`
  runs plain eslint, job `test` runs `pnpm run test`, `test:coverage`, `test:int`, and the
  migration gates). `.github/workflows/eslint.yml` (workflow `ESLint`) is a separate
  **required status check** that uploads SARIF to GitHub code scanning, stripping
  directive-suppressed and `react-hooks/*` + `jsx-a11y/*` results before upload.

### Generated-artifact drift gates

Three artifacts are generated but **committed**, so CI re-runs each generator with `--check` and
fails if the committed copy disagrees with the code. Re-run the generator and commit its output —
never hand-edit the artifact.

| Gate | Workflow | Refresh with |
|---|---|---|
| Studio descriptor metadata | `test.yml` — "Studio descriptor metadata drift gate" | `node tools/codegen/generate-studio-descriptor-registry.mjs` |
| Destructive schema diff | `test.yml` — "Destructive schema guard (vs origin/main)" | n/a — fix the migration, or set `ALLOW_DESTRUCTIVE_SCHEMA` |
| `openapi.yml` | `boot-guard.yml` — "OpenAPI drift gate" | `pnpm run build:backend && pnpm run openapi:generate` |

The OpenAPI gate lives in `boot-guard.yml` rather than `test.yml` because building the document
constructs `AppModule`, which instantiates every provider and therefore needs Postgres, Redis and
`JWT_SECRET` — only the boot-guard job provisions all three.

A generator that depends on paths must be **deterministic**: anything randomly seeded at
class-definition time (a `makeId()` in a decorator, say) leaks into the artifact and makes the gate
fail on every run. See `libraries/nestjs-libraries/src/dtos/auth/matches.property.validator.ts` for
the pattern that replaced one such case.

## Checklist

- [ ] Specs co-located as `*.spec.ts` (unit) / `*.int-spec.ts` (DB or recorded-fixture integration), matching the package's include globs — frontend specs must land inside the `apps/frontend/vitest.config.ts` allowlist.
- [ ] Relevant package suites green: `vitest run --root <pkg>`; full sweep `pnpm run test` before pushing.
- [ ] Coverage not regressed below the ratchet floors (`pnpm run test:coverage`); never lower a threshold to go green.
- [ ] `maxWorkers: 1` preserved for DB-harness / mock-sensitive packages.
- [ ] New provider: passes conformance + metadata specs automatically once registered in `providers.generated`; add an `*.int-spec.ts` with recorded fixtures via `makeCtx`/`res`, and `// UNVERIFIED vs live key:` where shapes are docs-derived; OAuth state from `makeOauthState()`.
- [ ] Frontend SWR specs wrapped in `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>`; dashboard hooks have sibling specs.
- [ ] `pnpm exec eslint . --report-unused-disable-directives` clean from the repo root; no new jsx-a11y warnings; no per-package lint scripts introduced.
