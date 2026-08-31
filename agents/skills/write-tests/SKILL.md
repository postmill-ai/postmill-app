---
name: write-tests
description: Write, run, and fix Vitest specs, provider conformance tests, Playwright E2E, and lint in the Postmill monorepo. Use when writing tests, adding specs, adding test coverage for a feature, running the test suite, or fixing test setup.
---

# Write tests

Add co-located Vitest specs that pass the package suite, the coverage ratchet, and root lint.

## Read first
- `agents/testing.md` — runner layout, per-package configs, DB harness, provider gates, lint rules.
- The doc for the area under test: `agents/providers/overview.md` (+ the domain doc) for provider work; `agents/backend.md` for endpoints/services; `agents/frontend.md` + `agents/ui-standards.md` for components/hooks.

## Procedure
1. **Place the spec co-located with the source** as `*.spec.ts` / `*.test.ts` (unit) or `*.int-spec.ts`
   (DB or recorded-fixture integration). There is no root `vitest.config.ts` — each package has its own
   config; match its include globs or the spec never runs. `libraries/helpers`, `apps/commands`,
   `apps/sdk`, `apps/extension` use the same plain co-located pattern, no special harness.
2. **Backend / `libraries/nestjs-libraries` unit specs.** Both configs run `pool: 'threads'`,
   `maxWorkers: 1`, `isolate: true` — each spec gets a fresh module registry so conflicting
   `vi.mock(...)` stubs (redis, Stripe) can't leak across files. `libraries/nestjs-libraries` also loads
   `setupFiles: ['./vitest.setup.ts']` (unit mocks) and includes `src/**/*.spec.ts` + `src/**/*.eval.ts`.
3. **DB-backed integration specs** live in `libraries/nestjs-libraries` as `*.int-spec.ts` and run under
   `vitest-integration.config.ts` (`globalSetup: ['./vitest-integration.global.ts']`, `maxWorkers: 1`,
   **no setupFiles** — they hit a real DB and must not load the unit mocks). The harness is
   `libraries/nestjs-libraries/src/testing/test-db.ts`: `createTestDatabase()` → `{ url, drop }` creates
   one throwaway `postmill_test_${process.pid}` database per run and pushes the full schema;
   `getTestPrisma(url)` returns a `PrismaClient` on it; the URL reaches specs via vitest
   `inject('dbUrl')`. Needs Postgres at `TEST_DATABASE_ADMIN_URL` (default
   `postgresql://postmill-local:postmill-local-pwd@localhost:5432/postgres`).
4. **Provider packages (`libraries/providers/<id>`).** Every module is gated repo-wide by specs in `libraries/providers/kernel/src/__tests__/`:
   - `all-providers.conformance.spec.ts` — iterates `providerModules` from `@postmill-ai/backend/providers.generated` and calls `runDomainConformance(domain, module, …)` from `kernel/src/testing/conformance.ts`. It throws on invalid manifest, domain mismatch, non-function `create()`, **network I/O during `create()`** (a throwing stub fetch is installed — `create()` must be pure), and missing `REQUIRED_METHODS` per domain. Registration in `providers.generated` enrolls a new module automatically — no separate test wiring.
   - `kernel.metadata.spec.ts` — registers all modules in a real `ProviderKernel`, checks `getMetadata`, model-category completeness, language codes.
   - `oauth-state.guard.spec.ts` — grep-guard over every `*/src/**/social.adapter.ts` and `kernel/src/domains/social-families/*-base.ts`: OAuth `state`/OIDC `nonce` must derive from `makeOauthState()` (128-bit) or legacy `makeId(>=32)`. Never hand-roll state generation.
   - Add an `*.int-spec.ts` with **recorded fixtures, no network**: build the context with `makeCtx(handler)` and responses with `res(body, ok, status)` from `kernel/src/testing/media-int-helpers.ts` — `ctx.fetch` records each `{url, method, headers, body}` and returns what your handler supplies; assert on both the recorded request and the parsed result. Where a response shape comes from vendor docs rather than a real key, mark the spec header with `// UNVERIFIED vs live key: …` (precedents: `vecteezy`, `envato`, `adobe-stock`, `suno`). Detail: `agents/testing.md` § Provider testing; `agents/providers/overview.md`.
5. **Frontend (`apps/frontend`).** jsdom + `@vitejs/plugin-react`; the config's `include` is an explicit allowlist of component dirs — a spec outside it silently never runs. Wrap SWR-using trees in `<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>` — fresh cache per test (precedent: `apps/frontend/src/components/settings/shortlinks/shortlinks.tab.spec.tsx:110`). Dashboard hooks in `src/components/dashboard/hooks/` get sibling `.spec.ts` files that `vi.mock` both `@postmill-ai/helpers/utils/custom.fetch` (`useFetch`) and `swr` rather than rendering. Never disable `react-hooks/rules-of-hooks` to make a test pass.
6. **E2E only for cross-page user flows** (auth flows, composer end-to-end, settings CRUD round-trips) that unit/integration tests can't cover; keep component behavior in vitest. Playwright lives in `e2e/` (outside the pnpm workspace scripts): `cd e2e && pnpm test` (aliases `test:headed`, `test:audit`, `report`). `e2e/playwright.config.ts`: `testDir: './tests'`, `workers: 1`, `retries: 1`, `baseURL: 'https://app.postmill.ai'` — **a live deployment, not localhost**; a `setup` project produces `.auth/state.json`. Check the config before running.
7. **Never add jest-style config.** Jest is gone from this repo (the old root `jest.config.ts` has been deleted); do not resurrect it, add a root vitest config, or introduce per-package lint/test runners.
8. **Lint from the repo root only**: flat `eslint.config.mjs` (ESLint 9 + eslint-config-next 16 native flat configs); there are no per-package lint scripts. Literal-string audit is opt-in: `I18N_LINT=1 pnpm exec eslint apps/frontend/src` (`i18next/no-literal-string` is `off` by default, `warn` with the env var — `eslint.config.mjs:81-91`). Do not re-enable the tracked-debt rules that are `off` (`@typescript-eslint/no-explicit-any`, `no-unused-vars`, `ban-ts-comment`) and do not add new jsx-a11y warnings.
9. **Coverage is a ratchet, not a target.** `pnpm run test` runs with **no** `--coverage`; `pnpm run test:coverage` enforces per-config floors at *measured* coverage (e.g. nestjs-libraries statements 72 / lines 73 over the AI/integrations/analytics surface; providers statements 75 / lines 70 with `all: false`; backend per-file controller thresholds; frontend scoped to `src/components/analytics/**` at 69/62/58/69). Never lower a threshold to go green (detail: `agents/testing.md` § Per-package config conventions).

## Verify
- `vitest run --root <pkg>` — the package you touched (e.g. `apps/backend`, `libraries/providers`, `libraries/nestjs-libraries`, `apps/frontend`).
- `pnpm run test` — full sweep over 8 roots in order: helpers → providers → nestjs-libraries → backend → frontend → commands → sdk → extension. Run before pushing.
- `pnpm run test:int` — DB integration specs (`vitest run --root libraries/nestjs-libraries --config vitest-integration.config.ts`); requires local Postgres.
- `pnpm run test:coverage` — confirm no ratchet floor regressed.
- Provider work: `vitest run --root libraries/providers` covers the conformance/metadata/oauth-state kernel suites automatically.
- `pnpm exec eslint . --report-unused-disable-directives` — from the repo root (what CI runs in `.github/workflows/test.yml`).

## Pitfalls
- Adding a new test runner, a root `vitest.config.ts`, or jest-style config — all forbidden; extend the package's existing include globs instead.
- Mocking Prisma where the package expects the real DB harness (`test-db.ts`), or importing unit `setupFiles` mocks into integration specs — the integration config deliberately has none.
- Assuming a new provider needs manual conformance test wiring — it's automatic via `providers.generated`; what it DOES need is a recorded-fixture `*.int-spec.ts` via `makeCtx`/`res`, and `create()` must stay pure (conformance installs a throwing stub fetch).
- Hand-rolling OAuth `state`/`nonce` generation — `oauth-state.guard.spec.ts` rejects anything not derived from `makeOauthState()` / `makeId(>=32)`.
- Bumping `maxWorkers` above 1 in backend / nestjs-libraries / integration configs — parallel workers collide on the single throwaway test database and on process-wide mocks.
- Frontend spec placed outside the `apps/frontend/vitest.config.ts` allowlist: it compiles fine but never executes.
- Running `e2e` specs assuming they boot a local app — they exercise the live `baseURL` deployment.
