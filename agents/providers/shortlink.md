# Adding a short-link provider

How to add a new link-shortening provider (domain `shortlink`) to the unified provider framework: one workspace package under `libraries/providers/<id>`, a `ShortLinkCapability` adapter, kernel registration, and zero frontend code. Follows the universal steps in `agents/providers/overview.md`.

Current inventory: 20 shortlink modules (`libraries/providers/PROVIDERS_INVENTORY.md`, `shortlink=20`) — 16 `apiKey`, 3 `none` (`cleanuri`, `isgd`, `vgd`), 1 `oauth2` (`bitly`).

## 1. Contract: `ShortLinkCapability`

Defined in `libraries/providers/kernel/src/domains/shortlink.ts`, re-exported from `@postmill-ai/provider-kernel`.

```ts
export interface ShortLinkCapability {
  readonly identifier: string;
  readonly name: string;
  readonly credentialFields: ShortLinkCredentialField[];
  readonly capabilities: ShortLinkCapabilities;
  readonly authType: 'none' | 'apiKey' | 'oauth2';
  readonly defaultDomain?: string;
  readonly setupNotes?: string;

  resolveDomain(ctx: ShortLinkContext): string;
  validateCredentials(ctx: ShortLinkContext): Promise<{ ok: boolean; error?: string }>;
  createShortLink(ctx: ShortLinkContext, originalUrl: string): Promise<{ shortUrl: string; providerLinkId?: string }>;
  expandShortLink?(ctx: ShortLinkContext, shortUrl: string): Promise<string>;
  linkStatistics?(ctx: ShortLinkContext, links: string[]): Promise<ShortLinkStat[]>;
  listLinks?(ctx: ShortLinkContext, page: number): Promise<ShortLinkStat[]>;
  oauth?: ShortLinkOauth;
}
```

Supporting types (same file):

| Type | Shape |
|---|---|
| `ShortLinkCredentialField` | `{ key, label, type: 'string' \| 'password' \| 'select', required, options?, placeholder? }` |
| `ShortLinkCapabilities` | `{ create, expand, statistics, bulkStatistics, customDomain }` — all `boolean` |
| `ShortLinkContext` | `{ orgId, credentials: Record<string,string>, customDomain?, extraConfig? }` |
| `ShortLinkStat` | `{ short, original, clicks: string }` — clicks is a **string** |
| `ShortLinkOauth` | `{ authorizeUrl(ctx, state, redirectUri, codeChallenge?): string; exchangeCode(code, redirectUri, ctx, codeVerifier?): Promise<Record<string,string>> }` |

`capabilities` flags must match the methods actually implemented (`linkStatistics` ⇒ `statistics`/`bulkStatistics`, etc.) — the conformance test checks this (§7). `authType` drives the settings UI: `oauth2` renders the Connect-with-OAuth block, `apiKey`/`none` render `credentialFields`.

## 2. Base class: `BaseShortLinkAdapter`

`libraries/providers/kernel/src/domains/shortlink.ts`. The base owns the two copy-pasted bodies — `validateCredentials` (GET an auth-protected endpoint, non-2xx ⇒ error) and `linkStatistics` (loop links, per-link `'0'` fallback on failure). The subclass fills three abstract hooks plus the provider-specific surface:

- `protected _headers(ctx)` — auth header set (`Bearer`, `Api-Key`, …).
- `protected _validateUrl(ctx)` — an endpoint whose 2xx proves the credentials.
- `protected _clicksFor(ctx, shortUrl): Promise<number>` — per-link click count.
- `resolveDomain(ctx)` — convention: `ctx.customDomain || this.defaultDomain`.
- `createShortLink(ctx, originalUrl)` — return `{ shortUrl, providerLinkId? }`.
- Optional: `expandShortLink`, `listLinks`, `linkStatistics` override, `oauth` object.

Reference: `libraries/providers/bitly/src/v1/shortlink.adapter.ts` (extends the base, `authType = 'oauth2'`, includes the `oauth` object with PKCE-aware `authorizeUrl`/`exchangeCode`). Note: only `bitly` and `blink` currently extend `BaseShortLinkAdapter`; the other 18 (e.g. `libraries/providers/dub/src/v1/shortlink.adapter.ts`) implement `ShortLinkCapability` directly. Prefer the base for new adapters.

Constructor takes `SafeFetchPort` (kernel-injected SSRF-safe fetch): `constructor(protected readonly _fetch: SafeFetchPort) {}` — use `this._fetch` for **all** outbound HTTP, never bare `fetch`.

## 3. Package layout and module export

Mirror `libraries/providers/bitly/`:

```
libraries/providers/<id>/
├── package.json            # name: @postmill-ai/provider-<id>, main/types: src/index.ts, test: vitest run
└── src/
    ├── index.ts            # default-exports ProviderModule[]
    └── v1/
        ├── shortlink.adapter.ts
        ├── metadata.ts     # ProviderMetadata
        └── __tests__/conformance.spec.ts
```

`src/index.ts` default-exports an array; the module wraps the adapter:

```ts
const _meta: ShortLinkCapability = new BitlyAdapter(undefined as unknown as SafeFetchPort);

export const bitlyShortlinkModule: ProviderModule<any, any> = {
  metadata: providerMetadata,
  manifest: {
    domain: 'shortlink',
    providerId: _meta.identifier,
    version: 'v1',
    displayName: _meta.name,
    status: 'active',
    credentialFields: _meta.credentialFields as any,
    capabilities: _meta.capabilities,
    authType: _meta.authType,
    defaultDomain: _meta.defaultDomain,
    setupNotes: _meta.setupNotes,
  },
  create: (rt) => new BitlyAdapter(rt.fetch),
};
```

Registration (manual edits despite the `generated` filename — no generator script exists):

1. Add `"@postmill-ai/provider-<id>": "workspace:*"` to `apps/backend/package.json`.
2. Add the two path aliases (`"@postmill-ai/provider-<id>"` and `"@postmill-ai/provider-<id>/*"`) to `tsconfig.base.json` — see `agents/providers/overview.md` § Registration for the exact shape.
3. Add the import (`import <id>Modules from '@postmill-ai/provider-<id>'`) and spread (`...<id>Modules`) to `apps/backend/src/providers.generated.ts` (`providerModules` array).
4. `pnpm install` from the repo root.

Boot: `apps/backend/src/providers.bootstrap.ts` registers modules with the kernel; domain `shortlink` is gated by the `shortlinks` feature flag (`DEV_DISABLE_SHORTLINKS`). Resolution at runtime goes through `ProviderResolutionService` — see `libraries/nestjs-libraries/src/short-linking/short.link.service.ts`, which calls `resolved.adapter.resolveDomain/createShortLink(...)`.

## 4. Database

Schema: `libraries/nestjs-libraries/src/database/prisma/schema.prisma`. **A new provider needs no schema change** — everything is keyed by `identifier`/`provider` string.

| Model | Purpose | Key columns / constraints |
|---|---|---|
| `OrgShortLinkConfig` (schema.prisma:1225) | Per-org provider config | `identifier`, `version` (default `"v1"`), `enabled`, `isActive`, `credentials` (encrypted), `customDomain`, `name`, `accountFingerprint`, `extraConfig`; `@@unique([organizationId, identifier, version, accountFingerprint])` |
| `ShortLink` (schema.prisma:1246) | A shortened URL | `provider`, `providerVersion`, `shortUrl`, `originalUrl`, `providerLinkId?`, `postId?`; `@@unique([organizationId, shortUrl])` |
| `ShortLinkSnapshot` (schema.prisma:1265) | Daily click counts | `clicks Float`, `date @db.Date`; `@@unique([shortLinkId, date])` |

Multi-instance support: an org can hold several configs for one provider, distinguished by `accountFingerprint`; `isActive` marks the primary.

## 5. Backend API and OAuth flow

Controller: `apps/backend/src/api/routes/org-shortlink-settings.controller.ts` — `@Controller('/settings/shortlinks')`, fully catalog-driven (new providers appear automatically):

| Endpoint | Purpose |
|---|---|
| `GET /providers` | Catalog list |
| `GET /config` | Per-org rows incl. `capabilities`, `credentialFields`, `version` |
| `PUT /config/:identifier` / `PUT /config/:identifier/:configId` | Create / update config (always sets `enabled: true`) |
| `POST /config/:identifier/set-active` | Mark primary |
| `POST /config/:identifier/test` | Runs `validateCredentials` |
| `DELETE /config/:identifier` | Remove |
| `POST /config/:identifier/oauth/url` | Build authorize URL (`oauth.authorizeUrl`) |
| `POST /config/:identifier/oauth/callback` | Exchange code (`oauth.exchangeCode`) |

OAuth server logic lives in `libraries/nestjs-libraries/src/short-linking/short-link-oauth.service.ts`. An `oauth2` adapter must read `clientId`/`clientSecret` from `ctx.extraConfig` (org-supplied, stored on `OrgShortLinkConfig.extraConfig`) — see `BitlyAdapter.oauth`.

## 6. Frontend: no new code

The settings surface is catalog-driven by the descriptor kit:

- `apps/frontend/src/components/settings/shared/kit/descriptors/shortlinks.descriptor.ts` (`shortlinksDescriptor`) — maps `GET /settings/shortlinks/config` rows into `ProviderRow`s; capability chips keyed off `ShortLinkCapabilities`; `form.oauth: true` renders the OAuth block for `authType === 'oauth2'` providers; `customDomain` is a built-in extra field.
- `apps/frontend/src/components/settings/shortlinks/shortlinks.tab.tsx` — renders `ProviderSettingsPanel` and wires `useOAuthReturn` (`storageKey: 'oauth_shortlink_provider'`, callback `/settings/shortlinks/config/${id}/oauth/callback`).

A new provider with correct `manifest.credentialFields`/`capabilities`/`authType` shows up in `/settings/shortlinks` with configure, test, set-primary, remove, and (if `oauth2`) Connect-with-OAuth — no frontend changes.

## 7. Legacy: shortlink icon PNGs

`scripts/generate-shortlink-icons.mjs` has a hand-maintained `PROVIDERS` map (id → hex color, 19 entries — `lnkify` is absent) and writes 48×48 PNG tiles to `apps/frontend/public/icons/shortlinks/<id>.png`. **Verification: nothing consumes these PNGs** — a repo-wide grep for `icons/shortlinks` outside the script and the `public/` output returns no references. Treat the script as optional/legacy: do not add your provider to `PROVIDERS` unless a consumer is (re)introduced.

## 8. Tests

- Conformance (required): copy `libraries/providers/bitly/src/v1/__tests__/conformance.spec.ts` — `runDomainConformance('shortlink', module, { requiredMethods: [...], capabilityKeys: ['create','expand','statistics','bulkStatistics','customDomain'] })` from `@postmill-ai/provider-kernel`.
- Adapter unit tests: mock `SafeFetchPort` and assert headers/URLs/parsing — see `libraries/providers/bitly/src/v1/__tests__/bitly.adapter.spec.ts`.
- Cross-cutting: `libraries/providers/kernel/src/__tests__/all-providers.conformance.spec.ts` enumerates `providerModules` — your module is picked up automatically once registered.
- Backend surface tests for reference: `apps/backend/src/short-linking-providers.spec.ts`, `apps/backend/src/api/routes/org-shortlink-settings.controller.spec.ts`.
- Run: `vitest run --root libraries/providers/<id>` and `vitest run --root libraries/providers/kernel`.

## Checklist

1. [ ] Create `libraries/providers/<id>/` (`package.json` named `@postmill-ai/provider-<id>`, `src/index.ts`, `src/v1/{shortlink.adapter.ts,metadata.ts}`).
2. [ ] Implement the adapter: extend `BaseShortLinkAdapter`, fill `_headers`/`_validateUrl`/`_clicksFor`/`resolveDomain`/`createShortLink`; set `identifier`, `name`, `authType`, `credentialFields`, `capabilities`, `defaultDomain`.
3. [ ] Set `capabilities` flags to match the methods actually implemented; add optional `expandShortLink`/`listLinks` only if the API supports them.
4. [ ] If OAuth2: set `authType = 'oauth2'`, add the `oauth` object (`authorizeUrl` + `exchangeCode`), read `clientId`/`clientSecret` from `ctx.extraConfig`.
5. [ ] Route all outbound HTTP through the injected `SafeFetchPort` (`this._fetch`) — never bare `fetch`.
6. [ ] Export a `ProviderModule` (`domain: 'shortlink'`, `version: 'v1'`, `status: 'active'`) and default-export `[module]` from `src/index.ts`.
7. [ ] Register: add the workspace dep to `apps/backend/package.json`, add the two path aliases to `tsconfig.base.json`, add import + spread to `apps/backend/src/providers.generated.ts`, run `pnpm install`.
8. [ ] Add `__tests__/conformance.spec.ts` via `runDomainConformance` plus fetch-mocked adapter unit tests.
9. [ ] Run `vitest run --root libraries/providers/<id>` and `vitest run --root libraries/providers/kernel`; verify the provider appears in `GET /settings/shortlinks/config` and the `/settings/shortlinks` UI.
10. [ ] Skip the legacy icon script (`scripts/generate-shortlink-icons.mjs`) unless a PNG consumer exists.
