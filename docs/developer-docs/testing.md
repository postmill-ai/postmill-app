# Testing

Postmill uses **Vitest** for all tests. The old root `jest.config.ts` has been deleted — do not add Jest-style configuration.

> Verified against v1.4.0

---

## Running Tests

### All packages

```bash
pnpm run test
```

This runs packages sequentially:

```
libraries/helpers
libraries/providers
libraries/nestjs-libraries
apps/backend
apps/frontend
apps/commands
apps/sdk
apps/extension
```

### With coverage

```bash
pnpm run test:coverage
```

### Single package

```bash
vitest run --root apps/backend
vitest run --root libraries/nestjs-libraries
vitest run --root apps/frontend
vitest run --root libraries/providers
```

### Single file or pattern

```bash
vitest run --root apps/backend src/api/routes/some-file.spec.ts
```

### Integration tests (real Postgres)

Repository/data-layer tests that need a real database live in `*.int-spec.ts` files and run against an isolated, per-run Postgres database created on the dev container:

```bash
pnpm run test:int
```

Requires the dev Postgres to be up (`docker compose -f ./docker/docker-compose.dev.yaml up -d`). The harness reads `TEST_DATABASE_ADMIN_URL` (see `.env.example`; defaults to the dev container's `postgres` admin DB) and creates/drops a throwaway `postmill_test_<pid>` database per run, pushing the current schema into it via `pnpm exec prisma db push`. The `*.int-spec.ts` suffix is not matched by the normal unit run; `test:int` uses `libraries/nestjs-libraries/vitest-integration.config.ts`.

---

## Vitest Configuration

Spec files are co-located next to their source files and use the `*.spec.ts` or `*.spec.tsx` extension.

### Backend (`apps/backend/vitest.config.ts`)

```ts
{
  include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
  pool: 'threads',
  maxWorkers: 1,
  isolate: true,
  environment: 'node',
  globals: true,
}
```

Coverage is measured per controller file with **ratchet floors** at measured levels rather than a single aspirational gate:

| File | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `public.analytics.v1.controller.ts` | 90 | 90 | 75 | 90 |
| `ai-settings.controller.ts` | 45 | 40 | 45 | 50 |
| `ai-user.controller.ts` | 70 | 50 | 75 | 70 |
| `ai-moderate.controller.ts` | 85 | 70 | 65 | 88 |
| `copilot.controller.ts` | 55 | 45 | 50 | 55 |
| `auth.controller.ts` | 35 | 15 | 20 | 35 |
| `stripe.controller.ts` | 90 | 80 | 90 | 90 |
| `payments.webhooks.controller.ts` | 90 | 80 | 90 | 90 |

### NestJS Libraries (`libraries/nestjs-libraries/vitest.config.ts`)

```ts
{
  include: ['src/**/*.spec.ts', 'src/**/*.eval.ts'],
  pool: 'threads',
  maxWorkers: 1,
  isolate: true,
  environment: 'node',
  globals: true,
}
```

Coverage is measured across integrations, analytics, AI, RAG, governance, and agent surfaces with aggregate ratchet floors:

| Metric | Floor |
|---|---|
| Statements | 72 |
| Branches | 62.5 |
| Functions | 72 |
| Lines | 73 |

### Frontend (`apps/frontend/vitest.config.ts`)

```ts
{
  include: [
    'src/components/analytics/**/*.spec.{ts,tsx}',
    'src/components/dashboard/**/*.spec.{ts,tsx}',
    'src/components/settings/ai/**/*.spec.{ts,tsx}',
    'src/components/media-tools/designer/*.spec.{ts,tsx}',
    // … ~60 explicit entries in total
    'src/app/**/*.spec.{ts,tsx}',
  ],
  environment: 'jsdom',
  globals: true,
  plugins: [react()],
}
```

The frontend `include` is an **explicit whitelist** of directories and individual spec files, not a
catch-all glob. A spec in a directory that is not listed never runs — add its path to
`apps/frontend/vitest.config.ts` when you create one.

Coverage is measured on `src/components/analytics/**/*.{ts,tsx}` (charts excluded) with ratchet floors:

| Metric | Floor |
|---|---|
| Statements | 69 |
| Branches | 62 |
| Functions | 58 |
| Lines | 69 |

---

## Single-Threaded Execution

The backend and nestjs-libraries configs set `maxWorkers: 1` (and `isolate: true`). This is intentional — tests that interact with the database, Redis, or shared state must run serially. Do not increase `maxWorkers` without verifying that all shared-state tests are properly isolated.

---

## Provider HTTP Mocking

Integration tests for channel providers mock outbound HTTP calls. The established pattern is to mock the `safeFetch` wrapper or the provider's `fetch` method rather than mocking `undici` directly.

AI adapter tests mock the underlying SDK package (e.g. `@ai-sdk/openai`, `@langchain/openai`) rather than making real API calls. Each adapter's specs live in its provider package (`libraries/providers/<id>/src/v1/__tests__/`).

---

## CI

### Security Audit

`.github/workflows/security-audit.yml` runs on PRs and weekly (Sunday midnight):

```bash
pnpm audit --audit-level=high
```

The check fails if any high or critical advisory is found, with two documented exceptions in the workflow: a small allowlist of advisories that have **no patched release** and are unreachable in practice (listed by GHSA id in the step comment — drop an entry as soon as a fix ships), and the npm quick-audit endpoint outage (`ERR_PNPM_AUDIT_BAD_RESPONSE`), which is tolerated as a warning. Any non-allowlisted high/critical advisory still fails the job. The same workflow also greps for reintroduced channel/short-link/email/storage env reads and bare `fetch()` in short-link adapters.

### Lint

Linting runs from the **repo root only** via the flat `eslint.config.mjs` config. There is no per-package `lint` script. The config uses eslint 9 with `eslint-config-next`.

To run lint:

```bash
pnpm exec eslint .
```

---

## Test Utilities

Common test patterns:

- **Backend unit tests:** Use NestJS `Test.createTestingModule` with mocked providers.
- **Repository tests:** Use `*.int-spec.ts` against the throwaway real-Postgres database (`pnpm run test:int`, see above).
- **AI governance tests:** Unit-test each governance service in isolation with mocked dependencies.
- **Frontend component tests:** Use `@testing-library/react` with the `jsdom` environment.
