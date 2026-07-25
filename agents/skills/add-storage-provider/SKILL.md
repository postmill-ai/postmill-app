---
name: add-storage-provider
description: Add a storage provider (S3-compatible object storage, file/media storage backend, bucket provider) to the Postmill provider kernel. Use when asked to add an S3-compatible backend, a new StorageProviderType, or wire a bucket into Settings → Storage.
---

# Add a storage provider

One-line purpose: scaffold a kernel storage package (usually via the `makeS3StorageModule`
factory), add the Prisma enum value + migration, register it, and update the hardcoded
settings UI lists.

## Read first
- `agents/providers/overview.md` — kernel contracts, package layout, registration, conformance gate.
- `agents/providers/storage.md` — storage-specific contract, factory shape, enum quirk, settings UI touchpoints.
- `agents/database.md` — migration workflow for the enum (`ALTER TYPE ... ADD VALUE`).

## Procedure
1. **Prisma enum first.** Add the value (e.g. `EXAMPLE`) to `enum StorageProviderType` in
   `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (enum at line ~815).
   - Author a committed migration containing only `ALTER TYPE "StorageProviderType" ADD VALUE 'EXAMPLE';`
     (precedent: `libraries/nestjs-libraries/src/database/prisma/migrations/20260714150606_add_medialocker_storage_type/migration.sql`).
   - Workflow per `agents/database.md`: `pnpm run prisma-migrate-dev`, then `pnpm run prisma-generate`.
   - The enum value must exactly equal the factory `type`: `StorageService.#storageTypeToKernelId`
     (`libraries/nestjs-libraries/src/database/prisma/storage/storage.service.ts:121`) maps it via
     `type.toLowerCase()` with underscores preserved (`BACKBLAZE_B2` → `backblaze_b2`).
2. **Scaffold the package** at `libraries/providers/<id>/` (S3 family). Model on
   `libraries/providers/backblaze-b2` or `libraries/providers/s3`
   (detail: `agents/providers/overview.md` § Package layout):
   - `package.json` — `@postmill-ai/provider-<id>`, `main`/`types: src/index.ts`,
     dep `@postmill-ai/provider-kernel: workspace:*`, script `test: vitest run`.
   - `src/index.ts` — default-exports `[<id>StorageModule]`.
   - `src/v1/{index.ts, metadata.ts, storage.adapter.ts}`.
3. **Fast path — factory.** In `src/v1/storage.adapter.ts` call
   `makeS3StorageModule({ type, displayName, credentialFields, resolveRegion?, resolveEndpoint? })`
   from `@postmill-ai/provider-kernel` (`libraries/providers/kernel/src/domains/storage-helpers.ts:386`);
   11 of 14 providers are this one file.
   - Set `metadata` on the returned module; `metadata.ts` uses `kind: 'action'`,
     `domains: ['media']`, `id` = `type.toLowerCase()` (factory sets `manifest.providerId`
     = `type.toLowerCase()` automatically).
4. **Bespoke only when non-S3.** Hand-roll `StorageCapability` only for non-S3 protocols —
   existing exceptions: `local` (filesystem), `medialocker` (REST presign), `cloudflare-r2`
   (multipart + presigned URLs).
   - Contract (`kernel/src/domains/storage.ts`): `uploadSimple`, `uploadFile`, `removeFile`,
     `testConnection`, `listFiles`, `getFileUrl`, `deleteFile`, `getUsageBytes`, `writeBuffer`,
     `readFile` + readonly `type`.
   - Reuse kernel helpers `parseDataUrl`/`fromBuffer`/`fromFile` and preserve the mime gating (step 7).
5. **Register — 3 edits + install.**
   - `apps/backend/src/providers.generated.ts` (hand-maintained despite the name): alphabetical
     `import <id>Modules from '@postmill-ai/provider-<id>';` + spread `...<id>Modules,` into `providerModules`.
   - `apps/backend/package.json`: `"@postmill-ai/provider-<id>": "workspace:*"` in dependencies.
   - `tsconfig.base.json`: both aliases `"@postmill-ai/provider-<id>": ["libraries/providers/<id>/src"]`
     and `"@postmill-ai/provider-<id>/*": ["libraries/providers/<id>/src/*"]`. Then `pnpm install`.
6. **Frontend — the settings form is NOT catalog-driven.** Hardcoded lists in 2 files (4 edit points):
   - `apps/frontend/src/components/settings/storage/provider-form.modal.tsx`:
     - `allProviderTypes` (line 14) — add `{ value: 'EXAMPLE', label: 'Example Storage' }`.
     - `TYPE_FIELD_SPECS` (line 71) — add **only** if fields differ from the S3 defaults
       (`accessKeyId`/`secretAccessKey` + `region`/`bucket`/`endpoint`/`publicUrl`); unlisted types
       fall back to `DEFAULT_CREDENTIAL_SPECS`/`DEFAULT_CONFIG_SPECS` (precedent: `MEDIALOCKER` entry).
   - `apps/frontend/src/components/settings/storage/storage.tab.tsx`: `PROVIDER_TYPE_LABELS` (line 99)
     and `CLOUD_TYPES` (line 118).
   - Optional icon: `apps/frontend/src/components/shared/provider-icon.tsx`
     (`ICONS`/`FALLBACK_COLORS`/`LABEL_MAP`); otherwise a 2-letter fallback tile renders.
7. **Mime allowlist invariant.** Uploads are restricted to image/video/audio/font mimes
   (`ALLOWED_MIME_TYPES`, `storage-helpers.ts:84`); `writeBuffer` uses
   `STORED_ARTIFACT_ALLOWED_MIME` (line 108). Bespoke adapters must preserve equivalent gating.
8. **Tests.** Add `src/v1/__tests__/conformance.spec.ts` calling
   `runDomainConformance('storage', mod, { requiredMethods: [...all 10...] })` — copy
   `libraries/providers/cloudflare-r2/src/v1/__tests__/conformance.spec.ts`. The repo-wide
   `kernel/src/__tests__/all-providers.conformance.spec.ts` covers it once registered.
9. **Inventory.** Update `libraries/providers/PROVIDERS_INVENTORY.md` by hand (no generator script
   exists): add the module row and bump the `storage=` count.

## Verify
- `pnpm run prisma-migrate-dev` then `pnpm run prisma-schema-check` — enum migration applies, no destructive drift.
- `pnpm --filter @postmill-ai/provider-<id> test` — package conformance spec.
- `vitest run --root libraries/providers` — repo-wide conformance + metadata specs pass.
- Smoke: Settings → Storage → Add Provider, pick the new type, save, run Test Connection.

## Pitfalls
- Skipping the enum migration: schema-only edits break at runtime — the DB enum lacks the value
  and `CreateStorageConfigDto`'s `@IsEnum(StorageProviderType)` / inserts fail. Commit an
  `ALTER TYPE ... ADD VALUE` migration; never `db push` a shared DB.
- Assuming the settings form is catalog-driven: it is NOT. Forget `allProviderTypes` /
  `PROVIDER_TYPE_LABELS` / `CLOUD_TYPES` and the type is invisible or unlabeled in the UI.
- Enum/factory mismatch: `type` in `makeS3StorageModule` must equal the Prisma enum value
  exactly; resolution goes through `type.toLowerCase()` with underscores preserved
  (`backblaze_b2`, not `backblaze-b2` — the package dir name uses hyphens, the providerId does not).
- Writing a bespoke adapter when the factory suffices: only `local`, `medialocker`, `cloudflare-r2`
  justify bespoke code. Likewise, don't add `TYPE_FIELD_SPECS` for a standard S3 provider.
- Calling bare `fetch` in a bespoke adapter: outbound HTTP must use `ctx.fetch` (SafeFetchPort).
