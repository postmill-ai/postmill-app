---
name: add-social-provider
description: Add a new social media channel / posting provider (OAuth or API-key channel integration) to the Postmill provider kernel. Use when adding a social provider, posting channel, OAuth channel integration, or composer channel support.
---

# Add a social channel provider

Create a `social`-domain provider package under `libraries/providers/<id>` — adapter, kernel module, capabilities entry, settings DTO, composer UI, icon, tests. Reference implementations: `libraries/providers/tumblr` (OAuth2), `libraries/providers/pixelfed` (customFields/instance).

## Read first
- `agents/providers/overview.md` — universal recipe: package layout, `package.json` conventions, registration edits, conformance gate.
- `agents/providers/social.md` — social-specific contract: `SocialAbstract`/`SocialProvider` members, capabilities matrix, settings DTO, composer wiring, error semantics.

## Procedure

1. **Scaffold the package** `libraries/providers/<id>/` with `package.json` (`@postmill-ai/provider-<id>`, `main: "src/index.ts"`, dependency only on `@postmill-ai/provider-kernel`) and `src/index.ts` (default-export `[<id>SocialModule]`), `src/v1/{index.ts, metadata.ts, social.adapter.ts}` (detail: `agents/providers/overview.md` § Universal recipe).

2. **Check family bases first.** If the platform speaks the Mastodon, Instagram/Facebook-Graph, or LinkedIn API, extend `MastodonProvider` / `InstagramProvider` / `LinkedinProvider` (`libraries/providers/kernel/src/domains/social-families/`, e.g. `mastodon-base.ts:19`) and override only deltas. Otherwise `extends SocialAbstract implements SocialProvider`.

3. **Implement the adapter** in `src/v1/social.adapter.ts`:
   - Contract: `SocialProvider` (`kernel/src/domains/social-provider.ts:192`), base `SocialAbstract` (`kernel/src/domains/social-base.ts:96`) providing `this.fetch()`, `runInConcurrent`, `checkScopes`.
   - Required members (conformance-enforced): `identifier` (stable machine id — keys the capabilities map, settings union, frontend array, icon filename), `name`, `editor` (`'none'|'normal'|'markdown'|'html'`), `scopes`, `isBetweenSteps`, `maxConcurrentJob`, `maxLength()`, `checkValidity()`, plus `post()`, `generateAuthUrl()`, `authenticate()`.
   - Auth: OAuth2 → `generateAuthUrl`/`authenticate`/`refreshToken` (return an empty-string stub from `refreshToken` if the platform has none); API-key/instance → `customFields()` returning `{key,label,defaultValue?,validation,type}` fields. OAuth `state` must be `makeOauthState()` from `@postmill-ai/provider-kernel` (`kernel/src/domains/social-make-id.ts`) — the state is the CSRF token / Redis capability key, ≥128-bit.

4. **HTTP discipline.** All platform calls via `this.fetch(url, options, identifier?)` (SSRF dispatcher, VPN egress, 30s timeout, 429/5xx retry); media downloads via `safeFetch`. Override `handleErrors(body, status)`: return `{type:'refresh-token'}` → token refreshed and retried; `{type:'bad-body'}` → post fails with the message; `{type:'retry'}` → 5s sleep, retry ≤2 (detail: `agents/providers/social.md` § 8).

5. **Export the module** at the tail of `social.adapter.ts`: wrap `new <Id>Provider()` in `SocialProviderKernelAdapter` (`kernel/src/domains/social-bridge.ts`) with manifest `{domain:'social', providerId, version:'v1', status:'active', credentialFields:[], capabilities: PROVIDER_CAPABILITIES[identifier] || {}}` — copy the exact tumblr pattern.

6. **Capabilities entry (mandatory).** Add `PROVIDER_CAPABILITIES['<id>']` in `kernel/src/domains/social-capabilities.ts`: 12 fields — `analytics`, `comments`, `firstComment`, `poll`, `video`, `carousel`, `altText`, `maxMedia`, `linkPreview`, `refreshToken`, `watchlist`, optional `richText` (absent = supported).

7. **Settings DTO (lockstep edits).** If the provider has per-post settings: DTO in `kernel/src/domains/social-dtos/<id>.dto.ts` + re-export shim `libraries/nestjs-libraries/src/dtos/posts/providers-settings/<id>.dto.ts` + set `dto = <Id>Dto` on the adapter. Register in `libraries/nestjs-libraries/src/dtos/posts/providers-settings/all.providers.settings.ts` in **both** the `AllProvidersSettings` union (`| ProviderExtension<'<id>', <Id>Dto>`) and the `allProviders()` array (`{ value: <Id>Dto, name: '<id>' }`). No settings → `None` in the union and `{ value: setEmpty, name: '<id>' }` (tumblr/pixelfed pattern).

8. **Registration — 3 edits + install.** (a) `apps/backend/src/providers.generated.ts`: `import <id>Modules from '@postmill-ai/provider-<id>'` and `...<id>Modules,` spread, both alphabetical (hand-maintained, no generator); (b) `tsconfig.base.json`: two path aliases `@postmill-ai/provider-<id>` and `@postmill-ai/provider-<id>/*`; (c) `apps/backend/package.json`: `"@postmill-ai/provider-<id>": "workspace:*"`. Then `pnpm install`.

9. **Optional surfaces.** Env OAuth click-connect: row in `CHANNEL_ENV_MAPPINGS` (`libraries/nestjs-libraries/src/integrations/channel-env-credentials.ts:24`). Comments surface: implement `ISocialMediaComments` (`social-provider.ts:147`) — `commentsCapabilities` getter, `fetchComments`, `replyToComment`, `likeComment` — and set `comments: true` in capabilities. No Prisma schema change: `Integration` and `OrgProviderConfiguration` are generic.

10. **Frontend (required).**
    - Composer component `apps/frontend/src/components/composer/providers/<id>/<id>.provider.tsx` via `withProvider` from `@postmill-ai/frontend/components/composer/providers/high.order.provider` (`postComment`, `maximumCharacters`, `dto`/`SettingsComponent` when applicable).
    - Register in the `Providers` array in `apps/frontend/src/components/composer/providers/show.all.providers.tsx` (`{ identifier: '<id>', component: <Id>Provider }`).
    - Icon: square PNG at `apps/frontend/public/icons/platforms/<identifier>.png` — filename must equal `identifier` exactly (referenced as `/icons/platforms/${identifier}.png`).

## Verify

```bash
pnpm install
vitest run --root libraries/providers/<id>      # package unit tests
vitest run --root libraries/providers/kernel    # conformance + oauth-state grep-guard
pnpm run build:backend                          # registration wiring compiles
```

## Pitfalls
- **Bare `fetch()`** for platform HTTP — must be `this.fetch()` or `safeFetch`; the SSRF/VPN/timeout layer is skipped otherwise.
- **Missing `PROVIDER_CAPABILITIES` entry** — the manifest reads `PROVIDER_CAPABILITIES[identifier] || {}`, so a missing key silently yields empty capabilities and breaks the composer UI; the capability flags drive posting behavior.
- **Wrong icon path** — social icons live at `apps/frontend/public/icons/platforms/<identifier>.png`; `components/shared/provider-icon.tsx` is for AI/media surfaces only. Filename must match `identifier` byte-for-byte.
- **Weak OAuth state** — `oauth-state.guard.spec.ts` grep-scans every `social.adapter.ts`: any `state`/`nonce` not from `makeOauthState()` (or `makeId(>=32)`) fails the kernel suite.
- **Half-done settings DTO** — updating only one of the `AllProvidersSettings` union / `allProviders()` array desyncs validation; the global pipe rejects undeclared fields, so every settings field must be on the DTO.
- **`editor: 'html'` overreach** — pick `'html'` only if the platform renders raw HTML (tumblr uses `'normal'` because NPF rejects raw tags).
