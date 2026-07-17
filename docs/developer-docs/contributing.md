# Contributing

This document covers ground rules, invariants, and the contribution workflow for Postmill.

---

## Ground Rules

### Package Manager

**pnpm only** — never use npm or yarn. The repo is a PNPM monorepo with workspaces driven by
`pnpm --filter`.

```bash
pnpm install          # also runs prisma-generate via postinstall
```

### Backend Layering

```
Controller → Service/Manager → Repository
```

- Only repositories touch Prisma. Controllers and services must not call Prisma directly.
- Services call other domain **services** — never their repositories.
- `apps/backend` stays thin: controllers + module wiring. Real logic in `libraries/nestjs-libraries`.

### Native Components Only

Do not install UI component libraries from npm. Write all components natively in
`apps/frontend/src/components/ui/` and `apps/frontend/src/components/`.

### SWR Hooks

Each SWR call must be its own hook. Never nest hook calls inside returned objects. Never suppress
`react-hooks/rules-of-hooks` with eslint-disable comments.

### Prisma Repository-Only Access

Schema at `libraries/nestjs-libraries/src/database/prisma/schema.prisma`. Run
`pnpm run prisma-generate` after schema edits. Run `pnpm run prisma-db-push` to apply changes.

---

## Invariants

These must never be broken. If you change code that touches any of these, verify the behaviour
stays intact.

### Per-Tenant AI — No Env Fallback

`AIModelProvider.resolveConfigForScope` returns `null` when an org has no active AI provider.
There is **no `OPENAI_API_KEY` env-var fallback**. A deployment's env key must never be silently
used as a tenant's AI provider. The frontend does not mount CopilotKit when AI is off and routes
the user to Settings → AI.

### Legacy Analytics Route Shape

The legacy analytics route at `GET /analytics/:integration` in the public integrations controller
is kept as-is for n8n/Zapier compatibility. Do not change its response shape. The v2 analytics
route is a parallel, separate endpoint at `/analytics/v2`.

### Provider Enablement Safety

Channel provider credentials live exclusively in `OrgProviderConfiguration`, encrypted at rest
through `EncryptionService`. There is no env-var fallback for any channel credential. Each
provider receives credentials through `clientInformation` or via `getOrgCredential(orgId,
identifier, key)`. Never read `process.env` for channel credentials.

### safeFetch for All Outbound HTTP

Every outbound HTTP call that involves a user-influenced URL must go through `safeFetch`
(`libraries/nestjs-libraries/src/dtos/webhooks/safe.fetch.ts`). Never use bare `fetch(userUrl)`.
`safeFetch` validates `isSafePublicHttpsUrl`, uses an SSRF-safe dispatcher, and re-validates on
every redirect hop.

### Helmet & Security Headers

`helmet()` is applied in `main.ts` after CORS. It sets HSTS, `noSniff`, `referrerPolicy:
strict-origin-when-cross-origin`, `frameguard: deny`, and a CSP. The `NOT_SECURED` env var skips
helmet entirely for dev/local use.

### Schema-Change Safety

Add columns as nullable or defaulted. New required columns without defaults break `db push`.
Renames/drops are destructive — provide an expand-contract plan.

---

## Contribution Workflow

### Before Starting

1. Read the plan in `dev/` for the current release if one exists
2. Understand the affected domains from the [Data Model](./data-model.md) and [Backend Conventions](./backend-conventions.md)
3. Run `pnpm install` to ensure the Prisma client is up to date

### Making Changes

1. Create a branch from `main`
2. Make your changes, following the conventions in this directory
3. Run `pnpm run test` to verify your package's tests pass
4. Run `npx eslint .` from the repo root to check lint
5. If you changed the schema, run `pnpm run prisma-generate`

### Commit Messages

Follow existing repo style: concise, present-tense, describing what the change does. Group related
changes in a single commit.

### PR Workflow

1. Push your branch
2. Open a PR against `main`
3. The CI workflow runs the security audit (`pnpm audit --audit-level=high`)
4. Request review from a maintainer
5. Address feedback in follow-up commits

### Review Checklist

When reviewing a PR, verify:

- [ ] No Prisma calls outside repository files
- [ ] Cross-domain calls go through services, not repositories
- [ ] No npm UI library installed
- [ ] Each SWR hook is its own function (not nested in a returned object)
- [ ] No eslint-disable for rules-of-hooks
- [ ] No `OPENAI_API_KEY` or channel credential env-var fallback introduced
- [ ] All outbound HTTP on user URLs uses `safeFetch`
- [ ] New DTO fields are declared (required for `whitelist` + `forbidNonWhitelisted`)
- [ ] Schema changes follow safety rules (nullable/defaulted)
- [ ] `pnpm run prisma-generate` succeeds if schema changed
- [ ] Tailwind classes only; no `--color-custom*` variables; no inline styles
- [ ] Legacy analytics route response shape preserved
- [ ] Documentation updated for any new feature/endpoint/env-var/schema model

---

## Documentation

Keep `docs/` in sync with code. Any new feature, endpoint, env var, schema model, or security
invariant must be reflected in the relevant page. Bump the "Verified against v1.0.0" footer on
every page you change.

---

## CLA

Contributors must sign the Contributor License Agreement before a PR can be merged. The CLA bot
will prompt you on your first PR.

> Verified against v1.0.0
