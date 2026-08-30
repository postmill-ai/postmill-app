# Adding an auth (login) provider

How to add a new platform login provider (OAuth/OIDC sign-in) to Postmill: a kernel `auth`-domain module in `libraries/providers/<id>`, a new `Provider` Prisma enum value, and wiring in `AuthProviderManager`. Reference implementation: `libraries/providers/github/src/v1/auth.adapter.ts`.

## IMPORTANT: auth providers are platform-level, not org-level

Unlike every other provider domain (AI, media, social, …), auth providers are **not** configured per org. They control how users sign into the whole deployment.

- Platform login providers are managed by a **separate administration app** (a distinct repo). This repo only **reads** `AuthProviderConfig` rows (DB-first) and falls back to deployment env vars. There is no `/admin` frontend or login-provider write API here.
- `LOCAL` (email/password) auth is always available. Self-service registration is gated by `DISABLE_REGISTRATION` (`AuthService.canRegister`, `apps/backend/src/services/auth/auth.service.ts:68`) — when `DISABLE_REGISTRATION=true`, registration is blocked **except** via `Provider.GENERIC` (OIDC SSO), which always bypasses the gate.
- OIDC SSO for self-hosted deployments is already covered by the `GENERIC` provider (`libraries/providers/generic/src/v1/auth.adapter.ts`) via the `POSTMILL_OAUTH_*` env vars — do not add a new provider just to point at a different OIDC IdP.
- Consequence: adding a new auth provider is **rare**. Confirm the work is not better done as a `GENERIC` OIDC configuration before writing code.

## Contract: `AuthCapability`

Defined in `libraries/providers/kernel/src/domains/auth.ts`:

```ts
export interface AuthUserInfo {
  email: string;
  id: string;
  picture?: string | null;
  name?: string | null;
}

export interface AuthCapability {
  generateLink(query?: unknown): Promise<string> | string;
  getToken(code: string, redirectUri?: string): Promise<string>;
  getUser(providerToken: string): Promise<AuthUserInfo> | false;
  postRegistration?(providerToken: string, orgId: string): Promise<void>;
}
```

- `generateLink` — build the provider's authorization URL (redirect target is `${process.env.FRONTEND_URL}/settings` in the GitHub adapter).
- `getToken` — exchange the OAuth `code` for an access token.
- `getUser` — fetch the user's identity; must return at least `email` and `id`. May return `false`.
- `postRegistration` — optional hook called after a new user/org is created (`AuthService` swallows its errors; a failure never fails registration, `apps/backend/src/services/auth/auth.service.ts:244`).

Call flow: `AuthController` (`apps/backend/src/api/routes/auth.controller.ts`) → `AuthService.oauthLink` / `AuthService.checkExists` (`apps/backend/src/services/auth/auth.service.ts:359`, `:364`) → `AuthProviderManager.getProvider(provider)` → kernel `create(ctx)`. Endpoints: `GET /auth/oauth/:provider` (link), `POST /auth/oauth/:provider/exists` (code exchange + login/register), `GET /auth/providers` (public provider list).

## Config resolution: DB-first, env fallback

Adapters resolve credentials themselves inside `resolveConfig(ctx)` (see `libraries/providers/github/src/v1/auth.adapter.ts:30`):

1. **DB first** — `AuthProviderManager.getProvider` (`apps/backend/src/services/auth/providers/auth-provider.manager.ts:143`) forwards the `AuthProviderRepository` and `ioRedis` through the runtime context: `ctx.extras = { authProviderRepo, redis }`. The adapter calls `repo.findByProvider('<PROVIDER>')`; if the row is `enabled` and has `clientId`/`clientSecret`, it wins.
2. **Decrypt with `ctx.encryption`** — `clientId` and `clientSecret` are stored encrypted (AES-GCM via `EncryptionService`); always `await ctx.encryption.decrypt(...)`. Never read them as plaintext.
3. **Env fallback** — e.g. `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`; throw `'<Provider> auth provider is not configured'` when neither source yields a full credential set.
4. **Outbound HTTP via `ctx.fetch`** — never bare `fetch` (see `agents/security.md`).

The adapter must define a local `AuthProviderRepoLike` structural interface (as in the GitHub adapter) so the package never imports `apps/backend`. `ctx.extras` is typed `Record<string, unknown>` (`libraries/providers/kernel/src/module.ts:11`) — cast it locally.

`AuthProviderManager.getProviders()` also **advertises** providers on the login page: DB-enabled rows take precedence; with no enabled DB rows it falls back to a hardcoded env-presence check per provider (`auth-provider.manager.ts:83-131`). A new provider needs a new env-gate block there, or the login page will never offer it. Note: the `WALLET` gate keys on `STRIPE_PUBLISHABLE_KEY` — a known misalignment flagged in a code comment; do not copy that pattern.

## Dual-use platform channel apps: FACEBOOK / X / LINKEDIN

Facebook, X, and LinkedIn login reuse the **platform channel app** — the operator's `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`, `X_API_KEY`/`X_API_SECRET`, and `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` from the `.env.example` "Channel OAuth apps" block (`CHANNEL_ENV_MAPPINGS` in `libraries/nestjs-libraries/src/integrations/channel-env-credentials.ts`). There is no separate login credential set; each adapter reads the same channel env vars.

Each is gated by an opt-in flag: `FACEBOOK_SSO_ENABLED`, `X_SSO_ENABLED`, `LINKEDIN_SSO_ENABLED`. The env gate in `AuthProviderManager.getProviders()` requires **both** the flag `=== 'true'` **and** the full channel credential set, so the login page never advertises a provider whose channel app is unconfigured.

## Prisma enum quirk (required)

The `provider` column is the Prisma `Provider` enum (`libraries/nestjs-libraries/src/database/prisma/schema.prisma:1621`): `LOCAL`, `GITHUB`, `GOOGLE`, `FARCASTER`, `WALLET`, `GENERIC` (the FACEBOOK/X/LINKEDIN dual-use providers add their own uppercase values via migration). A new login provider **must** add a new uppercase value to this enum via a **committed migration** (enum alteration — follow the migration workflow in `agents/database.md`). The kernel `providerId` is the lowercase form; `AuthProviderManager.getProvider` normalizes callers' uppercase enum values with `provider.toLowerCase()` before kernel lookup (`auth-provider.manager.ts:147`). `AuthProviderRepository.findByProvider` takes the Prisma `Provider` enum (`libraries/nestjs-libraries/src/database/prisma/auth-providers/auth-provider.repository.ts:17`).

## Database: `AuthProviderConfig`

`schema.prisma:1387`. One row per `(provider, version)` (`@@unique([provider, version])`, `version` defaults to `"v1"`):

| Column | Type | Notes |
|---|---|---|
| `provider` | `Provider` enum | uppercase |
| `enabled` | `Boolean` | default `false` |
| `clientId`, `clientSecret` | `String?` | encrypted at rest |
| `authUrl`, `tokenUrl`, `userInfoUrl` | `String?` | OIDC endpoints (GENERIC) |
| `scopes` | `String?` | default `"openid profile email"` |
| `displayName` | `String?` | login-page label |

Repository: `AuthProviderRepository` (`libraries/nestjs-libraries/src/database/prisma/auth-providers/auth-provider.repository.ts`) with `list()`, `findByProvider(provider, version)`, `upsert(...)`, `delete(...)`. Rows are written by the external administration app, not by this repo.

## Frontend registration (required)

The login page consumes `GET /auth/providers` and renders only providers it has a button for — adding an auth provider **does** require `apps/frontend` work (unlike the earlier revision of this doc claimed). Two touchpoints; without both, the provider never appears even when the backend advertises it:

- `providerComponents` (`apps/frontend/src/components/auth/login.tsx:42`) maps each advertised `provider` enum value to its button component (`GithubProvider`, `GoogleProvider`, …). Add an entry for the new provider — advertised providers without an entry are filtered out of the "Continue With" row (`login.tsx:64-66`).
- The OAuth-callback redirect map in `apps/frontend/src/proxy.ts:94` (`const providers = ['google', 'settings']`) rewrites an unauthenticated callback URL to `/auth?...&provider=<NAME>` by matching a substring of the URL (with the `settings` fragment resolving to `generic` or `github`). Add the new provider's callback-path fragment (e.g. `'facebook'`) so the OAuth callback lands on the login flow carrying the right `provider` param.

## Universal steps (compressed)

The full universal provider-package procedure (workspace package scaffold, `metadata.ts`, manifest fields, registration, conformance) is in `agents/providers/overview.md`. Auth-specific deltas:

- Domain is `auth`; manifest carries `authType: 'oauth2'` and typically `credentialFields: []` (credentials come from `AuthProviderConfig`/env, not org-scoped kernel credentials) — copy the manifest shape from `githubAuthModule` (`libraries/providers/github/src/v1/auth.adapter.ts:116`).
- Export a default array of modules from `libraries/providers/<id>/src/index.ts` (`export default [xAuthModule]`).
- Register by hand in `apps/backend/src/providers.generated.ts` (alphabetical import + spread). Despite the name the file is **hand-maintained**; `ProvidersBootstrap` (`apps/backend/src/providers.bootstrap.ts`) registers every module into the kernel at boot — the `auth` domain is never feature-flag-gated (`domainFlag` returns `true` for `auth`, `providers.bootstrap.ts:35`).

## Tests

- **Kernel conformance (automatic):** `libraries/providers/kernel/src/__tests__/all-providers.conformance.spec.ts` iterates every module in `providers.generated.ts` and asserts the created capability exposes the required auth methods `['generateLink', 'getToken', 'getUser']` — a new module is covered as soon as it is registered. Run: `vitest run --root libraries/providers/kernel`.
- **Manager spec:** extend `apps/backend/src/services/auth/providers/auth-provider.manager.spec.ts` for the new provider's `_versionInfo`/advertising behavior; `apps/backend/src/api/routes/auth.controller.spec.ts` covers the controller surface. Run: `vitest run --root apps/backend`.
- **Adapter unit test:** add `libraries/providers/<id>/src/v1/auth.adapter.spec.ts` mocking `ctx.fetch`, `ctx.encryption`, and a fake `authProviderRepo` in `ctx.extras`; assert DB-first → env-fallback precedence and the not-configured error. Package test script: `vitest run` (`"test": "vitest run"` in the package manifest). See `agents/testing.md`.

## Checklist

1. [ ] Confirm the need is real (not coverable by `GENERIC` OIDC) — auth providers are platform-level and managed by the external administration app.
2. [ ] Add the new uppercase value to the `Provider` enum in `libraries/nestjs-libraries/src/database/prisma/schema.prisma` and author the committed migration (`agents/database.md`); run `pnpm run prisma-generate`.
3. [ ] Scaffold `libraries/providers/<id>` (`@postmill-ai/provider-<id>`, deps on `@postmill-ai/provider-kernel` + `@postmill-ai/nestjs-libraries`) per `agents/providers/overview.md`.
4. [ ] Implement `src/v1/auth.adapter.ts`: a class implementing `AuthCapability` + an exported `ProviderModule` with manifest `domain: 'auth'`, lowercase `providerId`, `version: 'v1'`, `authType: 'oauth2'`.
5. [ ] Implement `resolveConfig`: DB-first via `ctx.extras.authProviderRepo.findByProvider('<PROVIDER>')`, decrypt with `ctx.encryption.decrypt`, env fallback, throw when unconfigured; all HTTP via `ctx.fetch`.
6. [ ] Export the module array from `src/index.ts` and register it (alphabetically) in `apps/backend/src/providers.generated.ts`.
7. [ ] Add the env-presence gate for the new provider in `AuthProviderManager.getProviders()` (`apps/backend/src/services/auth/providers/auth-provider.manager.ts`) so the login page can advertise it. For a dual-use channel-app provider (FACEBOOK/X/LINKEDIN pattern) the gate is the `<P>_SSO_ENABLED` flag AND the channel app env vars — not a separate login credential set.
8. [ ] Frontend: add the provider's button component to `providerComponents` (`apps/frontend/src/components/auth/login.tsx`) and its callback-path fragment to the redirect map in `apps/frontend/src/proxy.ts`.
9. [ ] Add/extend tests (`auth.adapter.spec.ts`, `auth-provider.manager.spec.ts`) and run `vitest run --root libraries/providers/kernel` + `vitest run --root apps/backend` — the conformance spec must pass with the new module registered.
