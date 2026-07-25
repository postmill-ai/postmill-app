---
name: add-shortlink-provider
description: Add a URL shortener / short-link provider (link shortening service, branded short domain) to Postmill's unified provider framework. Use when adding or scaffolding a shortlink provider package under libraries/providers, implementing ShortLinkCapability / BaseShortLinkAdapter, or wiring shortlink settings or OAuth connect.
---

# Add a short-link provider

Scaffold one workspace package implementing `ShortLinkCapability`, register it with the kernel, get catalog-driven settings UI with zero frontend code.

## Read first
- `agents/providers/overview.md` — universal provider recipe (package layout, manifest, registration).
- `agents/providers/shortlink.md` — shortlink domain specifics (base class, DB, OAuth, tests).

## Procedure

1. Study the contract in `libraries/providers/kernel/src/domains/shortlink.ts` (detail: `agents/providers/shortlink.md` §1). `ShortLinkCapability` requires `resolveDomain`, `validateCredentials`, `createShortLink`; optional `expandShortLink`, `linkStatistics`, `listLinks`, `oauth`. `authType` is `'none' | 'apiKey' | 'oauth2'`. Note: `ShortLinkStat.clicks` is a **string**.

2. Extend `BaseShortLinkAdapter` (same file, line 64) — do not implement the interface from scratch. The base already owns `validateCredentials` (GET `_validateUrl`, non-2xx ⇒ error) and `linkStatistics` (per-link loop, `'0'` fallback). Fill the abstract hooks:
   - `protected _headers(ctx)` — auth header set (`Bearer`, `Api-Key`, …).
   - `protected _validateUrl(ctx)` — endpoint whose 2xx proves credentials.
   - `protected _clicksFor(ctx, shortUrl): Promise<number>` — per-link click count.
   - `resolveDomain(ctx)` — convention: `ctx.customDomain || this.defaultDomain`.
   - `createShortLink(ctx, originalUrl)` — return `{ shortUrl, providerLinkId? }`.
   Set `identifier`, `name`, `credentialFields`, `capabilities`, `authType`, `defaultDomain`.
   Reference: `libraries/providers/bitly/src/v1/shortlink.adapter.ts` (the only `oauth2` example, includes the PKCE-aware `oauth` object); `libraries/providers/dub/src/v1/shortlink.adapter.ts` (plain `apiKey`, but implements the interface directly — prefer the base).

3. Route all outbound HTTP through the injected `SafeFetchPort`: `constructor(protected readonly _fetch: SafeFetchPort) {}` (inherited) and `this._fetch(...)` — never bare `fetch` (SSRF invariant).

4. Scaffold the package mirroring `libraries/providers/bitly/`: `package.json` (`@postmill-ai/provider-<id>`, `main`/`types`: `src/index.ts`, dep `@postmill-ai/provider-kernel: workspace:*`, script `test: vitest run`), `src/index.ts` default-exporting `ProviderModule[]`, `src/v1/{index.ts, metadata.ts, shortlink.adapter.ts}`. In `src/v1/index.ts` build the manifest with `domain: 'shortlink'`, `version: 'v1'`, `status: 'active'`, spreading `_meta` fields (`credentialFields`, `capabilities`, `authType`, `defaultDomain`, `setupNotes`); `create: (rt) => new <Id>Adapter(rt.fetch)` must be network-free.

5. Set `capabilities` flags (`create/expand/statistics/bulkStatistics/customDomain`) to match exactly the methods implemented — conformance checks this.

6. OAuth2 only: set `authType = 'oauth2'` and add the `oauth` object (`authorizeUrl(ctx, state, redirectUri, codeChallenge?)`, `exchangeCode(code, redirectUri, ctx, codeVerifier?)`). Read `clientId`/`clientSecret` from `ctx.extraConfig` (org-supplied, stored on `OrgShortLinkConfig.extraConfig`) — see `BitlyAdapter.oauth`.

7. Database: no schema change — everything keys on `identifier`/`provider` strings. Models in `libraries/nestjs-libraries/src/database/prisma/schema.prisma`: `OrgShortLinkConfig` (:1225, per-org encrypted config, multi-instance via `accountFingerprint`), `ShortLink` (:1246), `ShortLinkSnapshot` (:1265, daily clicks).

8. Frontend: write nothing. `apps/frontend/src/components/settings/shared/kit/descriptors/shortlinks.descriptor.ts` (`shortlinksDescriptor`) renders config/test/set-primary/remove from the manifest; `form.oauth: true` + the `oauth-block` render the Connect-with-OAuth flow automatically for `authType === 'oauth2'` (session key `oauth_shortlink_provider`). Endpoints: `apps/backend/src/api/routes/org-shortlink-settings.controller.ts` (`/settings/shortlinks/*`); OAuth server logic: `libraries/nestjs-libraries/src/short-linking/short-link-oauth.service.ts`.

9. Register — 3 edits + install:
   - `apps/backend/src/providers.generated.ts` (hand-maintained despite the name): alphabetical `import <id>Modules from '@postmill-ai/provider-<id>';` + `...<id>Modules,` in `providerModules`.
   - `tsconfig.base.json`: two aliases `"@postmill-ai/provider-<id>": ["libraries/providers/<id>/src"]` and `".../*": ["libraries/providers/<id>/src/*"]`.
   - `apps/backend/package.json`: `"@postmill-ai/provider-<id>": "workspace:*"` in `dependencies`.
   - `pnpm install` from repo root.
   Boot registration is automatic via `apps/backend/src/providers.bootstrap.ts`, gated by `DEV_DISABLE_SHORTLINKS`.

10. Tests: copy `libraries/providers/bitly/src/v1/__tests__/conformance.spec.ts` (`runDomainConformance('shortlink', module, {...})`), add fetch-mocked adapter unit tests (mock `SafeFetchPort`, assert headers/URLs/parsing). Skip `scripts/generate-shortlink-icons.mjs` — legacy, no consumer of the PNGs (verified: `agents/providers/shortlink.md` §7).

## Verify
- `vitest run --root libraries/providers/<id>`
- `vitest run --root libraries/providers/kernel` (cross-cutting `all-providers.conformance.spec.ts` picks up your module)
- `pnpm exec eslint libraries/providers/<id>` (repo root; flat `eslint.config.mjs` — no `lint` script exists)
- Manual: provider appears in `GET /settings/shortlinks/config` and the `/settings/shortlinks` UI with configure/test/(OAuth connect).

## Pitfalls
- Building frontend settings UI — unneeded; the descriptor kit renders everything from `manifest.credentialFields`/`capabilities`/`authType`.
- Declaring `statistics`/`bulkStatistics`/`expand` capability flags without implementing the matching methods (or vice versa) — conformance fails on the mismatch.
- Assuming OAuth2 machinery lives in the base class — it doesn't; only `bitly` has an `oauth` object. Copy its `authorizeUrl`/`exchangeCode` and read `clientId`/`clientSecret` from `ctx.extraConfig`.
- Returning numeric clicks — `ShortLinkStat.clicks` is a string (`String(clicks)`).
- Using bare `fetch` for provider API calls — all outbound HTTP goes through the injected `SafeFetchPort` (`this._fetch`).
- Adding your provider to `scripts/generate-shortlink-icons.mjs` — the PNGs have no consumer; treat the script as legacy.
