# Adding a storage provider

Storage providers are kernel packages under `libraries/providers/<id>` that implement `StorageCapability` and are backed by per-org `StorageProviderConfig` rows. Eleven of the fourteen existing storage packages are one-file factories built on `makeS3StorageModule`; a new S3-compatible provider is ~25 lines plus registration. See `agents/providers/overview.md` for the universal kernel steps; this doc covers only the storage-specific contract, the Prisma enum quirk, and the settings UI touchpoints.

## Contract: `StorageCapability`

Defined in `libraries/providers/kernel/src/domains/storage.ts`, re-exported from `@postmill-ai/provider-kernel`:

```ts
export interface StorageUploadProvider {
  uploadSimple(path: string): Promise<string>;       // URL or data: URL in, public URL out
  uploadFile(file: unknown): Promise<unknown>;       // multipart-style file object in
  removeFile(filePath: string): Promise<void>;
}

export interface StorageCapability extends StorageUploadProvider {
  readonly type: string;                             // == StorageProviderType enum value, e.g. 'BACKBLAZE_B2'
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  listFiles(prefix?: string): Promise<StorageFileEntry[]>;
  getFileUrl(key: string): string;                   // sync; uses publicUrl when set
  deleteFile(key: string): Promise<void>;
  getUsageBytes(): Promise<bigint | null>;           // null = unknown
  writeBuffer(buffer: Buffer, contentType?: string): Promise<string>;
  readFile(pathOrKey: string): Promise<Buffer>;
}
```

`StorageFileEntry` = `{ key, name, size, mimeType, lastModified }`. The conformance harness (`runDomainConformance('storage', …)`) requires all ten methods — see Tests below.

## Fast path: `makeS3StorageModule`

`libraries/providers/kernel/src/domains/storage-helpers.ts` exports `S3StorageBase` (full `StorageCapability` over `@aws-sdk/client-s3`: mime-sniffed uploads, `HeadBucket` test, paginated list/usage) and the module factory:

```ts
export interface S3StorageModuleConfig {
  type: string;                       // StorageProviderType enum value; also providerId = type.toLowerCase()
  displayName: string;
  credentialFields: CredentialField[];
  resolveRegion?: (region: string | undefined) => string;
  resolveEndpoint?: (region: string, endpoint: string | undefined) => string | undefined;
}
```

The returned capability lazily constructs `S3StorageBase` on first use (`create()` never throws — required for conformance) and validates required `credentialFields` before constructing. `region`/`bucket`/`endpoint`/`publicUrl` arrive via `ctx.extras` (see DB section); credentials via `ctx.credentials`; outbound HTTP for `uploadSimple` via `ctx.fetch` (SafeFetchPort — never import bare `fetch`).

Complete minimal package, modeled on `libraries/providers/backblaze-b2`:

```
libraries/providers/<id>/
  package.json            # name @postmill-ai/provider-<id>, main/types src/index.ts,
                          # dep @postmill-ai/provider-kernel: workspace:*, script test: vitest run
  src/index.ts            # default-exports [<id>StorageModule]
  src/v1/index.ts         # export { <id>StorageModule } from './storage.adapter';
  src/v1/metadata.ts      # ProviderMetadata (see below)
  src/v1/storage.adapter.ts
```

`src/v1/storage.adapter.ts`:

```ts
import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@postmill-ai/provider-kernel';

export const exampleStorageModule = makeS3StorageModule({
  type: 'EXAMPLE',                                        // must match the Prisma enum value
  displayName: 'Example Storage',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveRegion: (region) => region || 'us-east-1',
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://s3.${region}.example.com`,
});

exampleStorageModule.metadata = providerMetadata;
```

`src/v1/metadata.ts` (copy the sibling shape exactly — storage providers declare `kind: 'action'`, `domains: ['media']`):

```ts
import { ProviderMetadata } from '@postmill-ai/provider-kernel';

export const metadata: ProviderMetadata = {
  website: 'https://example.com/',
  description: { en: 'Example Storage — S3-compatible object storage.' },
  id: 'example',                 // matches manifest.providerId (type.toLowerCase())
  displayName: 'example',
  kind: 'action',
  domains: ['media'],
  hasModelList: false,
  mediaCategories: [],
};
```

Factory users today (11): `s3`, `backblaze-b2`, `idrive-e2`, `wasabi`, `digitalocean-spaces`, `hetzner`, `storj`, `scaleway`, `vultr`, `linode`, `s3-compatible`. `vultr` shows a package can carry a second domain module (`ai.adapter.ts`) alongside the storage one.

## Bespoke exceptions

Write a bespoke adapter (implement `StorageCapability` + hand-roll the `ProviderModule`, as in `cloudflare-r2/src/v1/storage.adapter.ts`) only when the factory can't express the provider:

| Package | Why bespoke |
|---|---|
| `cloudflare-r2` | Adds multipart upload (`createMultipartUpload`, `prepareUploadParts`, `completeMultipartUpload`, `abortMultipartUpload`, `listParts`, `signPart`) with presigned URLs; region is `'auto'`; endpoint is mandatory |
| `local` | Writes to the local filesystem; no credentials; tenant-scoped directories |
| `medialocker` | REST API (presign upload/download), not S3 protocol |

Even bespoke adapters reuse kernel helpers `parseDataUrl`, `fromBuffer`, `fromFile` (exported from `@postmill-ai/provider-kernel`) and the same mime allowlists. The allowlists in `S3StorageBase` are a security invariant: uploads are restricted to image/video/audio/font mimes (`ALLOWED_MIME_TYPES`), `writeBuffer` to `STORED_ARTIFACT_ALLOWED_MIME` (adds webm, `text/plain`, `application/json`) so a provider cannot land `text/html` in an org bucket. Preserve equivalent gating in bespoke code.

## Prisma enum quirk (critical)

A new storage provider requires a **new `StorageProviderType` enum value** in `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (enum at line 815; current values: `LOCAL`, `S3`, `CLOUDFLARE_R2`, `BACKBLAZE_B2`, `IDRIVE_E2`, `WASABI`, `DIGITALOCEAN_SPACES`, `HETZNER`, `STORJ`, `SCALEWAY`, `VULTR`, `LINODE`, `S3_COMPATIBLE`, `MEDIALOCKER`) **plus a committed migration**:

```sql
-- AlterEnum
ALTER TYPE "StorageProviderType" ADD VALUE 'EXAMPLE';
```

Precedent: `migrations/20260714150606_add_medialocker_storage_type/migration.sql`. Follow the migration workflow in `agents/database.md` (edit schema → `pnpm run prisma-migrate-dev` → diff/check → deploy). The enum value must exactly equal the factory's `type` (`'EXAMPLE'`), because:

- `StorageService.#storageTypeToKernelId` (`libraries/nestjs-libraries/src/database/prisma/storage/storage.service.ts:121`) maps the enum to the kernel providerId via `type.toLowerCase()` — underscores preserved (`BACKBLAZE_B2` → `backblaze_b2`), matching the factory's `providerId: cfg.type.toLowerCase()`.
- `CreateStorageConfigDto` (`libraries/nestjs-libraries/src/dtos/providers/provider-config.dtos.ts:159`) validates `type` with `@IsEnum(StorageProviderType)` — the new enum value automatically passes the global validation pipe; no DTO change needed.

## DB: `StorageProviderConfig`

`schema.prisma:832` — one row per org per configured instance:

| Column | Role |
|---|---|
| `type` / `version` | `StorageProviderType` + pinned version (`@default("v1")`) |
| `credentials` | Encrypted JSON (`EncryptionService`, AES-GCM); keys = the module's `credentialFields` |
| `region`, `bucket`, `endpoint`, `publicUrl` | Top-level config columns |
| `mounted`, `quotaBytes`, `defaultFolderId`, `accountFingerprint` | Mount/quota/folder binding; `@@unique([organizationId, accountFingerprint])` |
| `lastHealthCheck`, `lastHealthError` | Written by `testConnection` flows |

`StorageService.#buildAdapter` (`storage.service.ts:101`) decrypts `credentials` and calls `ProviderResolutionService.resolveStorage(providerId, { version, credentials, orgId, extras: { bucket, region, endpoint, publicUrl } })` — so the factory's `ctx.credentials` / `ctx.extras` map 1:1 to these columns. The kernel (`ProviderResolutionService`) is the sole resolution path.

## Registration (backend)

`apps/backend/src/providers.generated.ts` is **hand-maintained** (no generator script). Three edits:

1. `apps/backend/src/providers.generated.ts` — `import exampleModules from '@postmill-ai/provider-example';` (alphabetical) and spread `...exampleModules` into `providerModules`.
2. `apps/backend/package.json` — add `"@postmill-ai/provider-example": "workspace:*"` to dependencies.
3. `tsconfig.base.json` — add both path entries: `"@postmill-ai/provider-example": ["libraries/providers/example/src"]` and `"@postmill-ai/provider-example/*": ["libraries/providers/example/src/*"]`.

`pnpm-workspace.yaml` already globs `libraries/providers/*`. `libraries/providers/PROVIDERS_INVENTORY.md` claims to be machine-generated but **no generator script exists in-repo** — maintain it by hand: add the new module row and bump the `storage=14` count.

## Frontend (settings UI)

The storage settings UI does **not** read the catalog for its type lists — types are hardcoded in two files. Both must be updated:

- `apps/frontend/src/components/settings/storage/provider-form.modal.tsx`
  - `allProviderTypes` (line 14): add `{ value: 'EXAMPLE', label: 'Example Storage' }`. This drives the provider-type picker grid.
  - `TYPE_FIELD_SPECS` (line 71): **only** add an entry if the provider's credential/config fields differ from the S3 defaults (`accessKeyId`, `secretAccessKey` + `region`, `bucket`, `endpoint`, `publicUrl`). Unlisted types fall back to `DEFAULT_CREDENTIAL_SPECS` / `DEFAULT_CONFIG_SPECS`. Precedent: the `MEDIALOCKER` entry.
- `apps/frontend/src/components/settings/storage/storage.tab.tsx`
  - `PROVIDER_TYPE_LABELS` (line 99): add `EXAMPLE: 'Example Storage'`.
  - `CLOUD_TYPES` (line 118): add `'EXAMPLE'`.

The featured/catalog projection (`useProviderCatalog('storage')` → `GET /providers/catalog?domain=storage`) is sourced from registered kernel manifests — no frontend change needed for it once the module is registered in `providers.generated.ts`. `GET /providers/catalog` is authenticated; unknown `?domain=` → 400.

Icon (optional): `apps/frontend/src/components/shared/provider-icon.tsx`. Without any entry the tile falls back to a 2-letter label (`name.slice(0,2)` → `LABEL_MAP[identifier]` → `identifier.slice(0,2)`) on a deterministic palette color. To polish: add an `ICONS` glyph, a `FALLBACK_COLORS` entry, and a `LABEL_MAP` entry keyed by the enum value (e.g. `EXAMPLE: 'Ex'`).

## Tests

- Conformance spec in the new package at `src/v1/__tests__/conformance.spec.ts`, copied from `libraries/providers/cloudflare-r2/src/v1/__tests__/conformance.spec.ts`: find the storage module in the package's default export and call `runDomainConformance('storage', mod, { requiredMethods: ['uploadSimple','uploadFile','removeFile','testConnection','listFiles','getFileUrl','deleteFile','getUsageBytes','writeBuffer','readFile'] })`.
- Repo-wide conformance: `libraries/providers/kernel/src/__tests__/all-providers.conformance.spec.ts` iterates `providerModules` — it covers the new module automatically once registered.
- Backend behavior: `apps/backend/src/api/routes/storage.controller.spec.ts` exercises `/settings/storage` CRUD/test flows.
- Run: `pnpm --filter @postmill-ai/provider-example test`, or the whole providers tree with `vitest run --root libraries/providers`. See `agents/testing.md`.

## Checklist

1. [ ] Add the `StorageProviderType` enum value in `libraries/nestjs-libraries/src/database/prisma/schema.prisma` and author the migration (`ALTER TYPE ... ADD VALUE`) per `agents/database.md`; run `pnpm run prisma-generate`.
2. [ ] Create `libraries/providers/<id>/` with `package.json`, `src/index.ts`, `src/v1/index.ts`, `src/v1/metadata.ts`, `src/v1/storage.adapter.ts` using `makeS3StorageModule` (or a bespoke `StorageCapability` only if the S3 factory genuinely doesn't fit).
3. [ ] Set the factory `type` to the exact enum value; verify `providerId` (`type.toLowerCase()`) matches `StorageService.#storageTypeToKernelId` output.
4. [ ] Register the package: import + spread in `apps/backend/src/providers.generated.ts`, dependency in `apps/backend/package.json`, two paths in `tsconfig.base.json`; run `pnpm install`.
5. [ ] Refresh `libraries/providers/PROVIDERS_INVENTORY.md` (module row + per-domain count).
6. [ ] Frontend: add the type to `allProviderTypes` in `provider-form.modal.tsx`, `PROVIDER_TYPE_LABELS` and `CLOUD_TYPES` in `storage.tab.tsx`; add `TYPE_FIELD_SPECS` only for non-default fields; optionally add icon entries in `provider-icon.tsx`.
7. [ ] Add `src/v1/__tests__/conformance.spec.ts` with `runDomainConformance('storage', …)` and all ten required methods.
8. [ ] Run `pnpm --filter @postmill-ai/provider-<id> test` and `vitest run --root libraries/providers`; fix any conformance or metadata failures.
9. [ ] Smoke-test in the UI: Settings → Storage → Add Provider, pick the new type, save, and run Test Connection on the created config.
