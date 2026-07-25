# Adding a content pack provider (premium stock)

Enables adding a premium, BYOK stock-media content pack to the `contentpack` domain of the unified provider framework. A content pack overrides the free stock providers per capability for orgs that configure it; undeclared capabilities keep falling back to free stock.

See `agents/providers/overview.md` for the universal provider-package steps (workspace package, `ProviderModule`, registration); this doc covers only the contentpack-domain specifics.

## Scope: premium packs only

Free stock providers (Unsplash, Pexels, Pixabay, GIPHY, Jamendo, Iconify) are intentionally outside versioning — no stored config row, keyed off deployment env. Do not model them as content packs. This doc covers premium/BYOK packs stored per org. Existing packs: `libraries/providers/envato`, `libraries/providers/vecteezy`, `libraries/providers/magnific`, `libraries/providers/adobe-stock`.

## Contract: `ContentPackCapability`

Defined in `libraries/providers/kernel/src/domains/contentpack.ts`.

```ts
export interface ContentPackCapability {
  readonly identifier: string;
  readonly name: string;
  readonly capabilities: ContentPackCapabilityName[]; // 'photos'|'vectors'|'icons'|'videos'|'stickers'|'audio'

  search(
    capability: ContentPackCapabilityName,
    query: string,
    page?: number,
    filters?: Record<string, string>,
  ): Promise<StockSearchResponse<any>>;

  resolveDownload(id: string, capability: ContentPackCapabilityName): Promise<string>;
}
```

- `capabilities` — declare only what the pack actually serves. Anything **not** declared falls back to the free provider for that capability (`resolveSearch` in `libraries/nestjs-libraries/src/media/stock/stock-media.service.ts`).
- `search` returns `StockSearchResponse<T>` (`{ results, page, totalPages, configured, source }`). Item shapes (`StockPhotoItem`, `StockVectorItem`, `StockVideoItem`, `StockStickerItem`, `StockIconItem`, `StockAudioItem`) are defined in the same kernel file and are structurally identical to the consumer types in `libraries/nestjs-libraries/src/media/stock/stock.types.ts`.
- `resolveDownload(id, capability)` mints a licensed download URL from an item id (mint-then-ingest; consumed by `StockMediaService.importContentPackAsset` via `/files/import`). If the provider's entitlement flow gates full downloads, return the best preview URL and document that in the file header (see Envato's precedent).
- Reference implementation: `libraries/providers/envato/src/v1/contentpack.adapter.ts` (`EnvatoContentPack`, exported as `envatoContentPackModule`).

## Module manifest

Each version exports a `ProviderModule` (`libraries/providers/kernel/src/module.ts`):

```ts
export const myPackModule: ProviderModule<any, any> = {
  metadata: providerMetadata,           // src/v1/metadata.ts — content packs use domains: ["media"]
  manifest: {
    domain: 'contentpack',              // single word; NOT 'content-pack'
    providerId: 'mypack',
    version: 'v1',
    displayName: 'My Pack',
    status: 'active',
    credentialFields: [{ key: 'apiKey', label: 'API Token', type: 'password', required: true }],
    capabilities: ['photos', 'vectors'], // must match the class's declared capabilities
  },
  create: (ctx) => new MyPackContentPack(ctx.credentials.apiKey, ctx.fetch),
};
```

Note the two domain spellings: `manifest.domain` is `'contentpack'` (kernel identity domain, used by the settings catalog), while `metadata.domains` is `["media"]` (verified for both envato and adobe-stock).

## HTTP, credentials, errors

- **All outbound HTTP goes through the injected `SafeFetchPort`** (`ctx.fetch` in `create`, stored as a constructor arg). Never call global `fetch` — the kernel port is the SSRF-safe path (see `agents/security.md`).
- **Credentials arrive already decrypted** on `ctx.credentials`; the adapter class takes them as plain constructor args (`EnvatoContentPack(apiKey, fetch)`). Never encrypt/decrypt inside the adapter.
- **Error convention:** on HTTP 429 from the upstream API, throw `ContentPackDailyCapError` (exported from `@postmill-ai/provider-kernel`, defined in `kernel/src/domains/contentpack.ts`). `ProviderExceptionFilter` (`apps/backend/src/api/filters/provider-exception.filter.ts`) maps it to **HTTP 402 Payment Required** so the UI shows "limit reached". Other upstream failures: throw a plain `Error` with status + body text; `StockMediaService.resolveSearch` catches non-cap errors and degrades to the free provider (cap errors are rethrown, not degraded).

## Persistence: `ContentPackConfig`

Per-org BYOK config lives in the `ContentPackConfig` Prisma model (`libraries/nestjs-libraries/src/database/prisma/schema.prisma:1450`):

| Column | Notes |
|---|---|
| `organizationId` | org scope, cascade delete |
| `identifier` | provider id (e.g. `envato`) |
| `version` | default `"v1"` — pinned until explicit upgrade |
| `credentials` | encrypted JSON (`EncryptionService`), nullable |
| `extraConfig` | provider-specific non-secret JSON |

Unique on `@@unique([organizationId, identifier, version])`. The org-wide active pack is a **pointer**, not a per-row flag: `Organization.activeContentPackIdentifier` (null = free default). Service layer: `OrgContentPackSettingsService` (`libraries/nestjs-libraries/src/database/prisma/content-packs/org-content-pack-settings.service.ts`) — `getActiveForCapability(orgId, capability)` is the resolution entry point used by stock search and import.

## Frontend: no new code

- The settings surface is the Provider Settings Kit descriptor `contentPacksDescriptor` at `apps/frontend/src/components/settings/shared/kit/descriptors/content-packs.descriptor.ts` (route `/settings/content-packs`). It is catalog-driven (`catalogDomain: 'contentpack'`): a new pack registered in the kernel catalog appears automatically with its `credentialFields`, capability chips, configure/test/make-primary/remove flows.
- The six stock browsers — `apps/frontend/src/components/media-tools/stock-photos.tsx`, `stock-videos.tsx`, `stock-vectors.tsx`, `stock-icons.tsx`, `stock-stickers.tsx`, `stock-audio.tsx` — call backend `/media/stock/<capability>` via `useStockSearch`. The backend picks the active pack per capability, so premium packs show up with **no frontend changes**; undeclared capabilities silently fall back to the free providers.

## Integration-spec convention (recorded fixtures, no network)

Each pack ships `src/v1/contentpack.int-spec.ts` (reference: `libraries/providers/envato/src/v1/contentpack.int-spec.ts`):

- Import shared helpers from `@postmill-ai/provider-kernel/testing/media-int-helpers` (`libraries/providers/kernel/src/testing/media-int-helpers.ts`): `makeCtx(handler)` returns `{ recs, ctx }` where `ctx.fetch` records each request `{ url, method, headers, body }` and `handler(url, init, n)` returns the canned response; `res(body, ok?, status?)` builds a minimal fetch-Response-like object. New specs import these — do not copy a local helper.
- Seed credentials on the recording ctx before `create`: `(ctx as any).credentials = { apiKey: 'token' }`, then `myPackModule.create(ctx as any)`.
- Assert the exact URL, method, auth headers, and the mapped result shape for `search` and `resolveDownload`; include a 429 → `ContentPackDailyCapError` case (`res({}, false, 429)`).
- Add a file-header comment block describing the upstream API shape and an explicit `// UNVERIFIED vs live key:` line for anything not confirmed against a live key (e.g. Envato's licensed-download entitlement flow). Honest unverified notes are required, not optional.
- A plain unit spec (`contentpack.adapter.spec.ts`, `vitest` with a `vi.fn()` fetch mock) complements the int-spec for mapping/pagination edge cases.

## Registration

`providers.generated.ts` is hand-maintained despite its name (alphabetical order). See `agents/providers/overview.md` for the full list; the contentpack-relevant steps:

1. Workspace package `libraries/providers/<id>` named `@postmill-ai/provider-<id>` (`main`/`types`: `src/index.ts`, dependency `@postmill-ai/provider-kernel: workspace:*`, `test: vitest run`). `src/index.ts` default-exports the module array: `const mypackProviderModules = [myPackModule]; export default mypackProviderModules;`
2. Import + spread in `apps/backend/src/providers.generated.ts` (alphabetical).
3. Path mapping in `tsconfig.base.json`; dependency in `apps/backend/package.json`.

## Tests

- `pnpm --filter @postmill-ai/provider-<id> test` — runs the adapter spec + int-spec.
- Backend filter coverage for the 429 → 402 mapping already exists (`apps/backend/src/api/filters/provider-exception.filter.spec.ts`); no new backend test is needed unless you change the error type.

## Checklist

- [ ] 1. Create `libraries/providers/<id>/` package (`package.json`, `src/index.ts` default-exporting the modules array).
- [ ] 2. Write `src/v1/metadata.ts` (`domains: ["media"]`) and `src/v1/contentpack.adapter.ts` implementing `ContentPackCapability` with only the capabilities the pack truly serves.
- [ ] 3. Export `myPackModule` from `src/v1/index.ts`: `manifest.domain: 'contentpack'`, `credentialFields`, `capabilities` matching the class; `create` reads `ctx.credentials` and injects `ctx.fetch`.
- [ ] 4. Route every outbound request through the injected `SafeFetchPort`; throw `ContentPackDailyCapError` on 429.
- [ ] 5. Add `src/v1/contentpack.int-spec.ts` using `makeCtx`/`res` from `@postmill-ai/provider-kernel/testing/media-int-helpers`, with a file-header API description and `// UNVERIFIED vs live key:` notes; add `contentpack.adapter.spec.ts` for mapping edge cases.
- [ ] 6. Register: import + spread in `apps/backend/src/providers.generated.ts` (alphabetical), path mapping in `tsconfig.base.json`, dependency in `apps/backend/package.json`.
- [ ] 7. Run `pnpm --filter @postmill-ai/provider-<id> test` and confirm green.
- [ ] 8. Verify end-to-end: configure the pack at `/settings/content-packs`, make it Primary, and confirm the stock browsers serve pack results for declared capabilities and free-stock results for undeclared ones.
