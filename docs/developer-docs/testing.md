# Testing

Postmill uses **Vitest** for all tests. The root `jest.config.ts` is vestigial and should not be extended.

> Verified against v1.0.0

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

Requires the dev Postgres to be up (`docker compose -f ./docker-compose.dev.yaml up -d`). The harness reads `TEST_DATABASE_ADMIN_URL` (see `.env.example`; defaults to the dev container's `postgres` admin DB) and creates/drops a throwaway `postmill_test_<pid>` database per run, pushing the current schema into it via `pnpm exec prisma db push`. The `*.int-spec.ts` suffix is excluded from the normal unit run.

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
| `channel.config.controller.ts` | 90 | 90 | 90 | 90 |
| `analytics.v2.controller.ts` | 90 | 90 | 75 | 90 |
| `ai-settings.controller.ts` | 45 | 40 | 45 | 50 |
| `ai-user.controller.ts` | 70 | 50 | 75 | 70 |
| `ai-moderate.controller.ts` | 85 | 70 | 65 | 88 |
| `copilot.controller.ts` | 55 | 45 | 50 | 55 |
| `auth.controller.ts` | 35 | 15 | 20 | 35 |
| `stripe.controller.ts` | 90 | 80 | 90 | 90 |

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
    'src/components/analytics-v2/**/*.spec.{ts,tsx}',
    'src/components/launches/**/*.spec.{ts,tsx}',
    'src/components/dashboard/**/*.spec.{ts,tsx}',
    'src/components/settings/**/*.spec.{ts,tsx}',
    'src/components/shared/**/*.spec.{ts,tsx}',
    'src/components/ai/**/*.spec.{ts,tsx}',
    'src/components/media-tools/**/*.spec.{ts,tsx}',
    'src/components/composer/**/*.spec.{ts,tsx}',
    'src/components/campaigns/**/*.spec.{ts,tsx}',
    'src/components/agent/**/*.spec.{ts,tsx}',
    'src/components/agents/**/*.spec.{ts,tsx}',
    'src/components/setup/**/*.spec.{ts,tsx}',
    'src/components/new-layout/**/*.spec.{ts,tsx}',
    'src/components/layout/**/*.spec.{ts,tsx}',
    'src/redirects.config.spec.ts',
    'src/app/**/*.spec.{ts,tsx}',
  ],
  environment: 'jsdom',
  globals: true,
  plugins: [react()],
}
```

Coverage is measured on `src/components/analytics-v2/**/*.{ts,tsx}` (charts excluded) with ratchet floors:

| Metric | Floor |
|---|---|
| Statements | 69 |
| Branches | 62 |
| Functions | 58 |
| Lines | 69 |

---

## Single-Threaded Execution

Every vitest config sets `maxWorkers: 1`. This is intentional — tests that interact with the database, Redis, or shared state must run serially. Do not increase `maxWorkers` without verifying that all shared-state tests are properly isolated.

---

## Provider HTTP Mocking

Integration tests for channel providers mock outbound HTTP calls. The established pattern is to mock the `safeFetch` wrapper or the provider's `fetch` method rather than mocking `undici` directly.

AI adapter tests mock the underlying AI SDK (`@ai-sdk/provider-v5`) rather than making real API calls. Each adapter has a `*.spec.ts` file alongside it inside its provider package.

---

## CI

### Security Audit

`.github/workflows/security-audit.yml` runs on PRs and weekly (Sunday midnight):

```bash
pnpm audit --audit-level=high
```

The check fails if any high or critical advisory is found.

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
- **Repository tests:** Use an in-process test database; reset between tests.
- **AI governance tests:** Unit-test each governance service in isolation with mocked dependencies.
- **Frontend component tests:** Use `@testing-library/react` with the `jsdom` environment.
