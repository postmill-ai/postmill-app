---
name: add-contentpack-provider
description: Add a premium BYOK stock-media content pack provider (paid stock photos, vectors, icons, videos, stickers, audio) to the Postmill provider kernel. Use when adding a content pack, premium stock media provider, or BYOK stock photos/videos/icons/audio provider.
---

# Add a content pack provider

Wire a premium, per-org BYOK stock-media pack into the `contentpack` domain so it overrides the free stock providers per capability.

## Read first
- `agents/providers/overview.md` — kernel contracts, universal package layout, registration (skip nothing here).
- `agents/providers/contentpack.md` — contentpack-domain specifics: contract, errors, persistence, frontend, spec convention.
- `libraries/providers/envato/src/v1/contentpack.adapter.ts` — the reference implementation (envato, adobe-stock, vecteezy, magnific exist).

## Procedure

1. **Scope check.** This procedure is for premium/BYOK packs only. The six free stock providers (Unsplash, Pexels, Pixabay, GIPHY, Jamendo, Iconify) are intentionally outside versioning — never model them as content packs.

2. **Scaffold the package** `libraries/providers/<id>/` per the universal recipe: `package.json` named `@postmill-ai/provider-<id>` (`main`/`types`: `src/index.ts`, dep `@postmill-ai/provider-kernel: workspace:*`, script `test: vitest run`), `src/index.ts` default-exporting the module array, and `src/v1/{index.ts, metadata.ts, contentpack.adapter.ts}` (layout: `agents/providers/overview.md` § Package layout).

3. **Implement `ContentPackCapability`** from `libraries/providers/kernel/src/domains/contentpack.ts`:
   - `identifier`, `name`, `capabilities` — the capability list is `'photos'|'vectors'|'icons'|'videos'|'stickers'|'audio'`; declare only what the pack truly serves. Undeclared capabilities fall back to the free providers (`resolveSearch` in `libraries/nestjs-libraries/src/media/stock/stock-media.service.ts`).
   - `search(capability, query, page?, filters?): Promise<StockSearchResponse<any>>` — return `{ results, page, totalPages, configured, source }`; item shapes (`StockPhotoItem`, `StockVideoItem`, `StockAudioItem`, …) are defined in the same kernel file.
   - `resolveDownload(id, capability): Promise<string>` — mint a licensed download URL from an item id (mint-then-ingest via `StockMediaService.importContentPackAsset`); if full downloads are entitlement-gated, return the best preview URL and say so in the file header (Envato precedent).

4. **HTTP and credentials.** Every outbound request goes through the injected safeFetch port: `create(ctx)` receives `ctx.fetch` and the adapter stores it as a constructor arg. Never call global `fetch` — the kernel port is the SSRF-safe path. Credentials arrive already decrypted on `ctx.credentials`; pass them as plain constructor args (pattern: `new EnvatoContentPack(ctx.credentials.apiKey, ctx.fetch)`). No encryption inside the adapter.

5. **Errors.** On upstream HTTP 429, throw `ContentPackDailyCapError` (exported from `@postmill-ai/provider-kernel`). `ProviderExceptionFilter` (`apps/backend/src/api/filters/provider-exception.filter.ts`) maps it to HTTP 402. All other failures: throw a plain `Error` with status + body — `StockMediaService.resolveSearch` degrades those to free stock; cap errors are rethrown, never degraded.

6. **Module wiring** in `src/v1/index.ts`: `manifest.domain: 'contentpack'` (single word), `version: 'v1'`, `status: 'active'`, `credentialFields` (typically one `password` field), `capabilities` matching the class; `metadata.ts` uses `domains: ["media"]`. Keep `create()` network-free (conformance-tested).

7. **Persistence (no new schema).** Per-org BYOK config rows land in the existing `ContentPackConfig` Prisma model (unique `[organizationId, identifier, version]`, encrypted `credentials`); the org-wide active pack is the pointer `Organization.activeContentPackIdentifier` (null = free default). Resolution entry point: `OrgContentPackSettingsService.getActiveForCapability(orgId, capability)` in `libraries/nestjs-libraries/src/database/prisma/content-packs/org-content-pack-settings.service.ts`.

8. **Frontend: write nothing.** The catalog-driven descriptor `contentPacksDescriptor` (`apps/frontend/src/components/settings/shared/kit/descriptors/content-packs.descriptor.ts`, route `/settings/content-packs`) renders the pack from the kernel catalog automatically. The six stock browsers (`apps/frontend/src/components/media-tools/stock-{photos,videos,vectors,icons,stickers,audio}.tsx`) hit backend `/media/stock/<capability>`, which picks the active pack — undeclared capabilities silently fall back to free providers.

9. **Register — 3 hand edits:**
   1. `apps/backend/src/providers.generated.ts` (hand-maintained despite the name): `import <id>Modules from '@postmill-ai/provider-<id>';` and spread `...<id>Modules,` — both alphabetical.
   2. `tsconfig.base.json`: two aliases `"@postmill-ai/provider-<id>"` and `"@postmill-ai/provider-<id>/*"` → `libraries/providers/<id>/src[/ *]`.
   3. `apps/backend/package.json`: `"@postmill-ai/provider-<id>": "workspace:*"`, then `pnpm install`.

10. **Tests.** Add `src/v1/contentpack.int-spec.ts` (recorded fixtures, no network) using `makeCtx(handler)` / `res(body, ok?, status?)` from `@postmill-ai/provider-kernel/testing/media-int-helpers` (`libraries/providers/kernel/src/testing/media-int-helpers.ts`). Seed `(ctx as any).credentials = { apiKey: 'token' }` before `create`. Assert exact URL, method, auth headers, and mapped shapes for `search` + `resolveDownload`, plus a 429 → `ContentPackDailyCapError` case (`res({}, false, 429)`). Include a file-header API description and an explicit `// UNVERIFIED vs live key:` line for anything not confirmed live (required, not optional). Add `contentpack.adapter.spec.ts` (plain `vi.fn()` fetch mock) for mapping/pagination edge cases. The 429 → 402 filter mapping is already covered by `apps/backend/src/api/filters/provider-exception.filter.spec.ts`.

11. **Inventory.** Add the row and bump counts in `libraries/providers/PROVIDERS_INVENTORY.md` (hand-maintained).

## Verify

```bash
pnpm install
vitest run --root libraries/providers/<id>          # package specs
vitest run --root libraries/providers               # kernel conformance + metadata gate
```

Then end-to-end: configure the pack at `/settings/content-packs`, make it Primary, and confirm the stock browsers serve pack results for declared capabilities and free-stock results for undeclared ones.

## Pitfalls

- **Bare `fetch` in the adapter** — bypasses SSRF protection; only the injected `ctx.fetch` (SafeFetchPort) is allowed.
- **Swallowing or degrading the cap error** — `ContentPackDailyCapError` must propagate so it becomes HTTP 402; if you wrap it in a generic error the UI shows a 500 instead of "limit reached", and `resolveSearch` will silently fall back to free stock.
- **Building frontend UI** — the settings kit and the six stock browsers pick packs up automatically from the catalog; new frontend code is dead weight.
- **Modeling free stock providers as packs** — Unsplash/Pexels/Pixabay/GIPHY/Jamendo/Iconify live outside versioning with no config row; premium packs are per-org BYOK only.
- **Over-declaring `capabilities`** — anything listed must be genuinely served by `search`; undeclared capabilities are the supported fallback mechanism, not a gap.
- **Wrong domain spelling** — `manifest.domain` is `'contentpack'` (not `'content-pack'`), while `metadata.domains` is `["media"]`; mixing them up breaks registration or catalog rendering.
