---
name: add-auth-provider
description: Add a platform login/auth provider (OAuth login provider, OIDC/SSO provider, social login) to the Postmill monorepo — a kernel `auth`-domain module plus a `Provider` Prisma enum migration. Use when asked to add a login provider, OAuth sign-in, SSO, or social login.
---

# Add an auth (login) provider

Wire a new sign-in method (OAuth/OIDC) into the platform: kernel auth module + `Provider` enum migration + manager env gate.

## Read first
- `agents/providers/overview.md` — universal provider-package scaffold/registration recipe; kernel rules.
- `agents/providers/auth.md` — auth-domain deltas, `AuthCapability` contract, config resolution.
- `agents/database.md` § Enum additions for new providers — the `ALTER TYPE ... ADD VALUE` migration pattern.

## Framing (read before writing any code)

- Auth providers are **platform-level**, not org-level: they control sign-in for the whole deployment. They are managed by a **separate administration app**; this repo only **reads** `AuthProviderConfig` rows (DB-first via `ctx.extras.authProviderRepo`, env-bootstrap fallback, decrypt via `ctx.encryption`). There is no write API or admin UI here.
- `LOCAL` (email/password) is always available; registration is gated by `DISABLE_REGISTRATION` (`AuthService.canRegister`, `apps/backend/src/services/auth/auth.service.ts:68`). `Provider.GENERIC` (OIDC SSO) **bypasses** that gate.
- OIDC SSO is already covered by the `GENERIC` provider (`libraries/providers/generic/src/v1/auth.adapter.ts`) via `POSTMILL_OAUTH_*` env vars. **Do not add a provider just to point at a different OIDC IdP** — confirm the need is real first.

## Procedure

1. **Enum first.** Add the new uppercase value to `enum Provider` (`libraries/nestjs-libraries/src/database/prisma/schema.prisma:1621`: `LOCAL, GITHUB, GOOGLE, FARCASTER, WALLET, GENERIC`) via a committed migration — one line `ALTER TYPE "Provider" ADD VALUE '<NEW>';`, following the medialocker precedent `migrations/20260714150606_add_medialocker_storage_type/migration.sql` (detail: `agents/database.md` § Enum additions). Run `pnpm run prisma-generate`.
2. **Scaffold** `libraries/providers/<id>/` per the universal recipe (`agents/providers/overview.md` § Package layout): `package.json` (`@postmill-ai/provider-<id>`, dep on `@postmill-ai/provider-kernel`), `src/index.ts` default-exporting the module array, `src/v1/{index.ts, metadata.ts, auth.adapter.ts}`.
3. **Implement `AuthCapability`** (`libraries/providers/kernel/src/domains/auth.ts`) — reference `libraries/providers/github/src/v1/auth.adapter.ts`:
   - `generateLink(query?)` → authorization URL; `getToken(code, redirectUri?)` → access token; `getUser(providerToken)` → `AuthUserInfo` (`email`, `id` required; may return `false`); optional `postRegistration(providerToken, orgId)` (errors swallowed by `AuthService`, never fails registration).
   - Manifest: `domain: 'auth'`, lowercase `providerId`, `version: 'v1'`, `status: 'active'`, `authType: 'oauth2'`, `credentialFields: []` (credentials come from `AuthProviderConfig`/env, not org kernel credentials).
4. **Implement `resolveConfig(ctx)`** in the adapter: DB-first — `ctx.extras.authProviderRepo.findByProvider('<PROVIDER>')`; if the row is `enabled` with `clientId`/`clientSecret`, decrypt with `ctx.encryption.decrypt`. Env fallback (e.g. `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`); throw `'<Provider> auth provider is not configured'` when neither yields a full set. All HTTP via `ctx.fetch`, never bare `fetch`. Define a local `AuthProviderRepoLike` structural interface — the package must never import `apps/backend`.
5. **Register (3 edits):** import + alphabetical spread in the hand-maintained `apps/backend/src/providers.generated.ts`; two path aliases in `tsconfig.base.json`; `workspace:*` dep in `apps/backend/package.json`; then `pnpm install`. Boot registration is automatic (`ProvidersBootstrap`; the `auth` domain is never feature-flag-gated).
6. **Env gate:** add an env-presence block for the new provider in `AuthProviderManager.getProviders()` (`apps/backend/src/services/auth/providers/auth-provider.manager.ts:83-131`) or the login page will never advertise it.
7. **No new routes, no frontend work.** Endpoints already exist: `GET /auth/providers`, `GET /auth/oauth/:provider`, `POST /auth/oauth/:provider/exists` (`apps/backend/src/api/routes/auth.controller.ts:44,248,308`). Flow: controller → `AuthService.oauthLink`/`checkExists` → `AuthProviderManager.getProvider` (normalizes the uppercase enum to lowercase kernel id) → kernel `create(ctx)`. The login page renders whatever `GET /auth/providers` advertises.
8. **Tests:** add `src/v1/auth.adapter.spec.ts` (mock `ctx.fetch`, `ctx.encryption`, fake `authProviderRepo` in `ctx.extras`; assert DB-first → env-fallback precedence and the not-configured error); extend `apps/backend/src/services/auth/providers/auth-provider.manager.spec.ts` for the advertising behavior. Kernel conformance covers the new module automatically once registered.

## Verify

```bash
pnpm run prisma-migrate-dev            # apply the Provider enum migration locally
vitest run --root libraries/providers/<id>
vitest run --root libraries/providers  # conformance spec (generateLink/getToken/getUser)
vitest run --root apps/backend         # manager + auth controller specs
```

## Pitfalls

- **Treating this as org-level config.** Auth providers have no per-org settings UI and no write API in this repo — credentials live in `AuthProviderConfig` (written by the external admin app) or deployment env vars.
- **Copying the WALLET env-gate pattern.** The `WALLET` gate in `getProviders()` keys on `STRIPE_PUBLISHABLE_KEY` — a known misalignment flagged in a code comment (`auth-provider.manager.ts:123-124`). Gate on your provider's real env credentials.
- **Skipping the Prisma enum migration.** The `provider` column is the `Provider` enum; a kernel module alone is not enough — without the enum value, `AuthProviderRepository.findByProvider` and the DB rows cannot reference it.
- **Adding a provider for OIDC SSO.** `Provider.GENERIC` + `POSTMILL_OAUTH_*` already covers arbitrary OIDC IdPs and bypasses `DISABLE_REGISTRATION`.
- **Resurrecting legacy paths.** Comments referencing the `PROVIDER_KERNEL=legacy` decorator path (e.g. in the GitHub adapter) describe removed code — resolution is only through the kernel via `AuthProviderManager.getProvider`.
- **Bare `fetch` or plaintext secrets.** Outbound HTTP must go through `ctx.fetch`; DB-stored `clientId`/`clientSecret` are AES-GCM encrypted — always `await ctx.encryption.decrypt(...)`.
