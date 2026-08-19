# Provider framework: kernel essentials + add-a-provider recipe

Every provider domain (AI, media, storage, short-link, social, VPN, content pack, email, auth)
resolves through a single `ProviderKernel`; one workspace package per provider lives under
`libraries/providers/<id>`. This doc covers the kernel contracts and the universal recipe for
adding a provider; per-domain specifics are in the sibling docs linked at the end.

## Domains and identity

The 9 domains are the `ProviderDomain` union and `PROVIDER_DOMAINS` const in
`libraries/providers/kernel/src/identity.ts` (kept in lockstep via `satisfies`):

```ts
export type ProviderDomain =
  | 'ai' | 'media' | 'storage' | 'shortlink' | 'social'
  | 'vpn' | 'contentpack' | 'email' | 'auth';
```

- A provider version is addressed as the identity triple `domain/providerId@version`
  (e.g. `ai/openai@v1`). Helpers: `qualify()`, `parseQualified()`, `keyString()`,
  `isProviderDomain()` — all in `identity.ts`. `DEFAULT_VERSION = 'v1'`.
- Each domain's capability interface (the contract an adapter implements) lives in
  `libraries/providers/kernel/src/domains/<domain>.ts` (`ai.ts`, `media.ts`, `storage.ts`,
  `shortlink.ts`, `social.ts`, `vpn.ts`, `contentpack.ts`, `email.ts`, `auth.ts`).
- `validateManifest()` (`kernel/src/manifest.ts`) rejects unknown domains, `/` `@` or whitespace
  in `providerId`, and `@` `/` or surrounding whitespace in `version` — they break qualified-id
  round-tripping.

## Versioning and lifecycle

- Each version is an internal module inside the package: `src/v1`, `src/v2`, … The package's
  `src/index.ts` default-exports the array of all version modules.
- Config/ledger rows carry a non-null `version String @default("v1")` column (see
  `libraries/nestjs-libraries/src/database/prisma/schema.prisma`, e.g. the unique keys
  `[identifier, version]`, `[organizationId, identifier, name, version]`) and keep that version
  until an explicit upgrade — a new `v2` adapter never silently changes existing behavior.
- Lifecycle is `ProviderVersionStatus` (`kernel/src/manifest.ts`):
  `preview → active → deprecated → retired`.
  - `preview` — never selected by `latestActive`; a semver-prerelease version **must** be
    `preview` (enforced in `validateManifest`).
  - `deprecated` — rejects new writes: `kernel/src/kernel.ts` throws
    `ProviderVersionDeprecatedForWriteError` unless the caller passes `allowDeprecated`.
  - `retired` — `create()` throws `ProviderVersionRetiredError`, mapped to HTTP **410 Gone**
    (`GoneException`) in `libraries/nestjs-libraries/src/providers/provider-resolution.service.ts:446`.

## ProviderModule shape

`libraries/providers/kernel/src/module.ts`:

```ts
export interface ProviderModule<Caps = unknown, Capability = unknown> {
  manifest: ProviderManifest<Caps>;        // kernel/src/manifest.ts
  metadata?: ProviderMetadata;             // kernel/src/domains/metadata.ts
  create(ctx: ProviderRuntimeContext): Capability;
  validateCredentials?(ctx: ProviderRuntimeContext): Promise<CredentialValidationResult>;
  health?: ProviderHealth;
}
```

- `ProviderRuntimeContext` = `{ credentials, encryption, fetch, logger, telemetry, orgId?, extras? }`.
  `create()` must be pure — no network at construction (conformance-tested).
- `ProviderManifest` fields: `domain`, `providerId`, `version`, `displayName`, `status`,
  `credentialFields: CredentialField[]` (`key/label/type/required`, type ∈
  `string|text|password|textarea|json|select`), `capabilities`, plus optional `deprecatedAt`,
  `sunsetAt`, `universalCredentialFrom`, `icon`, `docsUrl`, `setupNotes`,
  `authType: 'none'|'apiKey'|'oauth2'`, `defaultDomain`.
- `tombstone(manifest)` (`module.ts`) builds a module whose `create()` always throws retired —
  use it for retired versions that must stay addressable.

## ProviderMetadata

`kernel/src/domains/metadata.ts` — static truth the defaults resolver, catalog endpoints, and
settings UI read instead of inferring from adapter capabilities. Authored as a small
`metadata.ts` per package version.

| Field | Notes |
|---|---|
| `id` | Must equal `manifest.providerId` (spec-enforced). |
| `displayName` | Brand name. |
| `uiName?` | UI suffix for `<provider>[-<ui-name>]: <model>` default formatting. |
| `kind` | `'direct'` (own models) \| `'hub'` (aggregator) \| `'action'` (no model list). |
| `domains` | `Array<'ai' \| 'media'>` — which default surfaces it may serve. |
| `modelCategories?` | Subset of `AI_MODEL_CATEGORIES`. |
| `mediaCategories?` | Subset of `AI_MEDIA_CATEGORIES`; each must be backed by `mediaModels`. |
| `hasModelList` | Whether the adapter implements `listModels`. |
| `modelHints?` | Per-category preferred model-id substrings, for ranking `listModels` output. |
| `mediaModels?` | Static per-category model catalog (`MediaModelDef[]` with `ModelField[]` settings). |
| `docsUrl?`, `website?`, `description?` | `description` is localized, `en` required. |

Category unions live in `libraries/nestjs-libraries/src/ai/defaults/default-categories.ts`:
`AI_MODEL_CATEGORIES` = `low-reasoning, high-reasoning, vision, workflow` (4);
`AI_MEDIA_CATEGORIES` = 16 values (`text-to-image`, `video-avatar`, …). Subset compliance is
enforced by `libraries/providers/kernel/src/__tests__/kernel.metadata.spec.ts`
("declares only known model/media categories", "backs every declared media category with a
model catalog").

## Universal recipe: add a provider

### Package layout

```
libraries/providers/<id>/
├── package.json
└── src/
    ├── index.ts                  # default-exports ProviderModule[]
    └── v1/
        ├── index.ts              # builds the ProviderModule (manifest + metadata + create)
        ├── metadata.ts           # ProviderMetadata
        ├── <domain>.adapter.ts   # implements kernel/src/domains/<domain>.ts
        └── __tests__/
```

`src/index.ts` shape (from `libraries/providers/bitly/src/index.ts`):

```ts
import { bitlyShortlinkModule } from './v1';
const bitlyProviderModules = [bitlyShortlinkModule];
export default bitlyProviderModules;
```

`package.json` conventions (verbatim from `@postmill-ai/provider-bitly`):

```json
{
  "name": "@postmill-ai/provider-<id>",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": { "@postmill-ai/provider-kernel": "workspace:*" },
  "license": "AGPL-3.0",
  "engines": { "node": ">=24.0.0 <25.0.0" },
  "scripts": { "test": "vitest run" }
}
```

### Registration — 4 hand edits

1. `apps/backend/src/providers.generated.ts` — despite the name this file is **hand-maintained**:
   add `import <id>Modules from '@postmill-ai/provider-<id>';` (alphabetical) and spread
   `...<id>Modules,` into the exported `providerModules: ProviderModule<any, any>[]` array
   (alphabetical). Multi-domain packages (e.g. `openai` = ai + media) export multiple modules
   from one array.
2. `tsconfig.base.json` — **two** path aliases:
   `"@postmill-ai/provider-<id>": ["libraries/providers/<id>/src"]` and
   `"@postmill-ai/provider-<id>/*": ["libraries/providers/<id>/src/*"]`.
3. `apps/backend/package.json` — add `"@postmill-ai/provider-<id>": "workspace:*"` to
   `dependencies`.
4. `pnpm install` — links the workspace package.

### Boot auto-registration

`apps/backend/src/providers.bootstrap.ts` (`ProvidersBootstrap.onModuleInit`) iterates
`providerModules` and calls `kernel.register(mod)`, gated per domain by `FeatureFlagsService`
(`libraries/nestjs-libraries/src/feature-flags/feature-flags.service.ts`):

| Domain | Gate |
|---|---|
| `ai` | `DEV_DISABLE_AI` |
| `media` | `DEV_DISABLE_MEDIA` |
| `shortlink` | `DEV_DISABLE_SHORTLINKS` |
| `email` | `DEV_DISABLE_EMAIL`, **except** providerId `empty` (always-on fallback) |
| `social`, `storage`, `vpn`, `contentpack`, `auth` | always on |

A `ProviderManifestError` (malformed manifest / duplicate registration) is **fatal at boot** —
it aborts startup and fails CI. Other registration errors are logged + Sentry-tagged and skipped.

## Conformance gate & verification

`libraries/providers/kernel/src/__tests__/all-providers.conformance.spec.ts` runs
`runDomainConformance` over **every** registered module: valid manifest, domain match, pure
`create()`, and the created capability must expose every non-optional method of its domain
interface. Required-method matrix (verified against the spec, which cross-checks
`kernel/src/domains/<domain>.ts`):

| Domain | Required methods |
|---|---|
| social | `post`, `generateAuthUrl`, `authenticate`, `maxLength`, `checkValidity` |
| media | `generateImage`, `generateVideo`, `generateAudio`, `generateAvatar` |
| storage | `uploadSimple`, `uploadFile`, `removeFile`, `readFile`, `writeBuffer`, `testConnection`, `listFiles`, `getFileUrl`, `deleteFile`, `getUsageBytes` (10) |
| shortlink | `createShortLink`, `validateCredentials`, `resolveDomain` |
| ai | `listModels`, `validateCredentials`, `createLanguageModel`, `createLangchainModel` |
| vpn | `validateConfig` |
| contentpack | `search`, `resolveDownload` |
| email | `send`, `isConfigured` |
| auth | `generateLink`, `getToken`, `getUser` |

The spec also locks base-class consolidation: migrated media adapters must extend
`BearerTokenMediaAdapter`, shortlink adapters `BaseShortLinkAdapter`.

Live-key verification is **opt-out**: `isProviderVerified(domain, providerId)` in
`kernel/src/verification.ts` returns `true` unless the key `domain/providerId` is in
`BETA_PROVIDER_KEYS` — a deliberately narrow set of media + contentpack adapters authored
without a live key (they get a "Beta" badge in settings). A new provider is verified by default;
add it to `BETA_PROVIDER_KEYS` only if it was built without a live key, and remove the key after
a live smoke test.

Run the gate with the workspace vitest config:
`vitest run --root libraries/providers` (conformance + metadata specs live in the kernel package).

## PROVIDERS_INVENTORY.md upkeep

`libraries/providers/PROVIDERS_INVENTORY.md` lists one row per registered **module** (a
multi-module package gets multiple rows). Although its header says "machine-generated", no
generator script exists in-repo — maintain it by hand:

- Add a row `| package | domain | providerId | version | status | has-spec? |` (alphabetical
  within its domain section).
- Update the header counts: **Modules** (`providerModules.length`), **Packages**, **Packages
  with at least one spec**, and the per-domain module counts
  (currently: ai=30, auth=6, contentpack=4, email=7, media=35, shortlink=20, social=36,
  storage=14, vpn=16 — verify against the file, they drift).

## Resolution & APIs

- `ProviderResolutionService` (`libraries/nestjs-libraries/src/providers/provider-resolution.service.ts`)
  is the **sole** resolution path from domain services to a `ResolvedProvider`
  (`{ module, capability, version }`). The legacy in-memory registries and the
  `PROVIDER_KERNEL=legacy` kill switch were removed — never resolve adapters any other way.
- `GET /providers/catalog?domain=` (`apps/backend/src/api/routes/providers.controller.ts`) —
  authenticated (`AuthGuard`); an unknown `?domain=` fails closed with **400**
  (`isProviderDomain` check in `resolveDomainFilter`).
- `GET /admin/providers/health?domain=` (same file, `AdminProvidersController`) — super-admin
  only: class-level `SuperAdminGuard` plus a per-handler `isSuperAdmin` assert; returns
  per-version health counters via `ProviderHealthService`.

## Per-domain docs

| Doc | Read this when |
|---|---|
| `agents/providers/ai.md` | Adding an LLM provider (BYOK); model categories, hubs vs direct. |
| `agents/providers/social.md` | Adding a posting channel; OAuth flow, composer UI, 36+ channels. |
| `agents/providers/media.md` | Adding a media-generation studio; descriptors, studio page, nav. |
| `agents/providers/storage.md` | Adding an upload/storage backend (S3-family, 10-method contract). |
| `agents/providers/shortlink.md` | Adding a URL shortener; `BaseShortLinkAdapter`. |
| `agents/providers/vpn.md` | Adding a VPN egress region (SOCKS5/HTTP-CONNECT). |
| `agents/providers/contentpack.md` | Adding a premium stock/content-pack source. |
| `agents/providers/email.md` | Adding an email sender; env-only credentials. |
| `agents/providers/auth.md` | Touching platform login providers (separate admin app owns writes). |

### Frontend work required?

| Domain | Frontend work | Where |
|---|---|---|
| social | **Yes** | Composer component under `apps/frontend/src/components/composer/providers/<id>/` (wired via `high.order.provider.tsx` + `show.all.providers.tsx`) and icon at `apps/frontend/public/icons/platforms/<id>.png`. |
| media (studio) | **Yes** | Descriptor `apps/frontend/src/components/media-tools/<id>/descriptor.ts`, studio page under `apps/frontend/src/app/(app)/(site)/media/<id>/`, nav entry in `apps/frontend/src/app/(app)/(site)/media/layout.tsx`; then re-run `node tools/codegen/generate-studio-descriptor-registry.mjs` (merges descriptor data into the package's `metadata.ts`; CI gate `--check` in `.github/workflows/test.yml`). |
| ai | Minor | Optional icon in `apps/frontend/src/components/shared/provider-icon.tsx`; `BASE_URL_PROVIDERS` in `apps/frontend/src/components/settings/shared/kit/descriptors/ai.descriptor.ts` only for endpoint-bringing providers (currently just `openai-compatible`). |
| shortlink, vpn, contentpack, storage | No | Catalog-driven settings kits render from manifest `credentialFields`. |
| email | No | Env-only credentials (e.g. `resend` reads `process.env.EMAIL_API_KEY`); no per-org config UI. |
| auth | No | Managed by the separate administration app; this repo only reads `AuthProviderConfig`. |

## Checklist

1. [ ] Scaffold `libraries/providers/<id>/` with `package.json` (conventions above), `src/index.ts` default-exporting `ProviderModule[]`, and `src/v1/{index.ts, metadata.ts, <domain>.adapter.ts}`.
2. [ ] Implement the domain capability from `libraries/providers/kernel/src/domains/<domain>.ts`, covering every method in the conformance matrix for your domain; keep `create()` network-free.
3. [ ] Author `manifest` (status `active`, or `preview` for prerelease versions) and `metadata.ts` with categories that are strict subsets of `AI_MODEL_CATEGORIES` / `AI_MEDIA_CATEGORIES`.
4. [ ] Register: import + alphabetical spread in `apps/backend/src/providers.generated.ts`; two aliases in `tsconfig.base.json`; `workspace:*` dep in `apps/backend/package.json`; `pnpm install`.
5. [ ] Do the domain's frontend work per the table above (social composer + icon, media studio descriptor/page/nav + `generate-studio-descriptor-registry.mjs`).
6. [ ] If built without a live key, add `domain/<id>` to `BETA_PROVIDER_KEYS` in `kernel/src/verification.ts`; remove it after a live smoke test.
7. [ ] Add package specs under `src/v1/__tests__/` (recorded-fixture `*.int-spec.ts` via `kernel/src/testing/` helpers where applicable).
8. [ ] Run `vitest run --root libraries/providers` — conformance + metadata specs must pass.
9. [ ] Update `libraries/providers/PROVIDERS_INVENTORY.md`: new row(s) + header counts.
