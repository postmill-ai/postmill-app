# Storage Setup

Postmill supports multiple storage backends for uploaded media: local disk, Cloudflare R2, AWS S3,
Backblaze B2, IDrive e2, Wasabi, DigitalOcean Spaces, Hetzner, Storj, Scaleway, Vultr, Linode, any
other S3-compatible service, and MediaLocker. Each organization can mount its own storage provider independently,
configured from the in-app Settings -> Storage page.

The platform base is selected by the operator with `STORAGE_PROVIDER=local|s3` (default `local`). It stores root/unmounted org files, avatars, and generated media. Local objects live under `<UPLOAD_DIRECTORY>/<tenantId>/`; platform S3 objects use `<tenantId>/YYYY/MM/DD/` in the configured bucket. Platform credentials stay in the environment and are never exposed to tenant admins.

Other providers (S3, R2, B2, IDrive e2, and the other cloud providers) can still be mounted per organization in Settings → Storage. An explicit provider-bound folder always takes precedence over the platform base, so changing the platform backend does not move or reconfigure BYO mounts.

The hosted-storage quota is driven by `LOCAL_STORAGE_QUOTA_GB` (default 5) in either platform mode. Each per-org provider config must be a **unique account** (credential fingerprint). The read-only **Postmill Storage** card represents the operator-selected base and reports tenant-scoped usage.

## Storage model

### `StorageProviderConfig`

Each storage provider mount is a row in the `StorageProviderConfig` table:

| Field | Description |
|-------|-------------|
| `type` | One of `LOCAL`, `S3`, `CLOUDFLARE_R2`, `BACKBLAZE_B2`, `IDRIVE_E2`, `WASABI`, `DIGITALOCEAN_SPACES`, `HETZNER`, `STORJ`, `SCALEWAY`, `VULTR`, `LINODE`, `S3_COMPATIBLE`, `MEDIALOCKER` |
| `name` | User-facing label |
| `mounted` | Whether this provider is actively serving files |
| `credentials` | Encrypted JSON: `accessKeyId`, `secretAccessKey`, `endpoint`, `region` |
| `bucket` | Bucket name (for S3-family providers) |
| `publicUrl` | Public base URL for file access |
| `quotaBytes` | Per-provider byte limit (null = use org quota) |
| `lastHealthCheck` | Timestamp of last connection test |
| `lastHealthError` | Error message from last failed connection test |
| `defaultFolderId` | Folder-level routing: uploads to this folder use this provider |
| `accountFingerprint` | SHA-256 of the distinguishing credentials (provider type + access-key ID). Unique per org — the same account cannot be added twice. |

> `StorageProviderConfig` rows represent BYO mounts. The operator-selected platform base is env-driven and does not create tenant credential rows.

### Per-org quota

Each organization's hosted storage has a **soft quota**: the default is driven by
`LOCAL_STORAGE_QUOTA_GB` (default `5`), and each org can carry an explicit override in
`localStorageQuotaBytes` (explicit value wins, else the env default). At 80% usage, a warning
banner appears in the storage settings. At 100%, new uploads are blocked until space is freed or
quota is raised. The same quota applies in local and platform-S3 mode.

## Storage backends

### Local platform storage (default)

Files are written to `UPLOAD_DIRECTORY` (e.g. `/uploads/`) on the container's filesystem, served
at `/uploads`. Simple but not redundant — a single container's disk, not shared across replicas.
Each tenant's files are written under its own partition,
`<UPLOAD_DIRECTORY>/<tenantId>/`.

```yaml
STORAGE_PROVIDER: 'local'
UPLOAD_DIRECTORY: '/uploads'
MEDIA_UPLOAD_MAX_BYTES: '1073741824'
```

### S3-compatible platform storage

Set `STORAGE_PROVIDER=s3` plus `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`, and `S3_PUBLIC_URL`. Set `S3_ENDPOINT` for Hetzner and other non-AWS services. Avatars, generated media, and root/unmounted org uploads all use the same tenant-partitioned bucket. Existing `/uploads/...` URLs return a 307 redirect to the identical key under `S3_PUBLIC_URL`, cacheable for five minutes; no database or Designer-document URL rewrite is required.

The backend and migration command require the complete S3 configuration. The frontend needs only `STORAGE_PROVIDER=s3` and `S3_PUBLIC_URL` to issue legacy redirects; it does not need the bucket credentials. Cached redirects remain safe during rollback because `copy-back` never deletes bucket objects.

For Hetzner, use an endpoint such as `https://fsn1.your-objectstorage.com` and the bucket's public URL. The bucket/CDN must support public object reads, CORS, and byte-range requests. Production backend startup fails closed with a variable-specific error when S3 configuration is incomplete.

### Cloudflare R2 (per-tenant)

S3-compatible object storage with no egress fees. Configure per-org in Settings → Storage with an
R2 API token's access key ID and secret, the bucket, and the bucket's S3 **endpoint**
(`https://<accountId>.r2.cloudflarestorage.com`). The endpoint is **required** for R2 — it cannot
be derived — and a config saved without one is rejected with HTTP 400 and not stored. A **Public
URL** (the bucket's custom domain or its `r2.dev` public URL) is also required: the connection test
fails without one, so the config is not saved, because stored files would otherwise get unusable
relative URLs. Existing R2 configs without a Public URL keep serving files they already stored, but
their connection test now reports this error.

### AWS S3 (per-tenant)

Native S3 API. Configure per-org in Settings → Storage using access key + secret.

**Required IAM permissions:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

**Bucket setup:**
1. Create an S3 bucket in your preferred region.
2. Optionally enable versioning and server-side encryption (Postmill encrypts at the application
   layer and does not require SSE — but enabling it adds an extra layer of protection).
3. Disable "Block all public access" if you intend to serve files publicly (Postmill can serve
   through presigned URLs instead).
4. Create an IAM user with programmatic access and attach the policy above.

**Credential format:**
- Access key ID: `AKIA...`
- Secret access key: the 40-character key paired with the access key ID

### Backblaze B2 (per-tenant)

S3-compatible API. Configure per-org with your B2 application key ID and key, plus the endpoint
for your bucket.

**Required permissions:** Create an application key (not a master key) scoped to a single bucket
with `readFiles`, `writeFiles`, `deleteFiles`, and `listFiles` capabilities.

**Bucket setup:**
1. Create a bucket in the B2 web console (or via CLI).
2. Go to App Keys → Add a New Application Key.
3. Give it a name (e.g. "Postmill"), select your bucket, and enable the four capabilities above.
4. Copy the `keyID` and `applicationKey` — the key is shown only once.

**Credential format:**
- Access key: `keyID` from the application key (e.g. `005...`)
- Secret key: `applicationKey` from the application key
- Endpoint: `https://s3.us-west-004.backblazeb2.com` (adjust region based on your bucket)

### IDrive e2 (per-tenant)

S3-compatible API. Configure per-org with your e2 access key and secret.

**Required permissions:** Create access keys from the e2 web console under "Create Access Keys."
The generated key pair has full access to your e2 account — IDrive does not currently offer
scoped/bucket-level keys.

**Bucket setup:**
1. Create a bucket in the IDrive e2 web console.
2. Go to Access Keys → Create Access Key.
3. Copy the `Access Key ID` and `Secret Access Key` — the secret is shown only once.

**Credential format:**
- Access key: the `Access Key ID` shown after creation
- Secret key: the `Secret Access Key` shown after creation
- Endpoint: `https://[region].idrivee2.com` (region is shown in the bucket details, e.g.
  `https://ewr1.idrivee2.com` for us-east-1)

### Other S3-compatible providers (per-tenant)

Wasabi, DigitalOcean Spaces, Hetzner, Storj, Scaleway, Vultr, Linode, and the generic
**S3-compatible** type use the same access key + secret, bucket, and endpoint fields as the
providers above. MediaLocker has its own credential form and, like R2, requires a Public URL (CDN
or public bucket base) for its connection test to pass. All are configured per-org in Settings →
Storage. If a provider's adapter rejects the submitted config, the save is rolled back and answers
HTTP 400 with the provider's message.

## Per-org storage management

Operators do not need to manage storage for individual orgs — org admins self-serve via Settings
-> Storage. The four-panel interface provides:

1. **Providers** — Cards showing type, mount status, last health check, usage percentage. Mount
   and unmount buttons. A non-LOCAL provider **mounts automatically** when it is created and its
   connection test passes, so a saved config is live immediately; the Mount button is for configs
   that were explicitly unmounted (or created before auto-mount existed). A provider stays mounted
   until an org admin explicitly unmounts it.
2. **Quota Status** — Usage meter with 80%+ amber warning and 100%+ red block.
3. **Usage Breakdown** — Bytes used by folder and by provider (pie charts/tables).
4. **Audit Log** — Paginated log of all storage operations: create, update, delete, mount,
   unmount, health-check, migrate, set-default-folder.

## File migration between providers

From the Storage tab, an org admin can migrate files between providers:

1. Both source and destination providers must be mounted and healthy.
2. The migration reads file bytes through the source adapter and writes through the destination
   adapter.
3. After a successful migration, files at the old location can be deleted.

Migrations are recorded in the audit log.

Moving a file (or a bulk selection) between folders in the Files library also migrates the bytes
when the source and destination folders are served by different providers: the object is read from
the source provider, checked against the destination's quota, written to the destination provider,
the file record is repointed to the new path, and the source object is removed (best-effort). A bulk
move skips files that fail without blocking the rest. Moving within the same provider only updates
the folder assignment.

## Platform local-to-S3 migration

Use a dedicated bucket and keep the original local tree until the S3 deployment has passed a soak period. Set all `S3_*` variables while leaving `STORAGE_PROVIDER=local`, set `UPLOAD_DIRECTORY` to the existing local root, and set `STORAGE_MIGRATION_DIRECTORY` to a persistent directory outside that root and outside the repository.

Before migrating an older installation, confirm that every top-level upload directory is a tenant partition. Pre-partition objects at `<UPLOAD_DIRECTORY>/YYYY/MM/DD/...` would be copied and remain viewable through redirects, but a tenant-scoped adapter cannot safely read or delete them after cutover because the key has no owner. Assign and re-home those objects beneath their tenant prefixes before cutting over; do not bypass tenant isolation with an unscoped fallback.

Build the commands app, then run:

```bash
cd apps/commands
pnpm exec dotenv -e ../../.env -- node -r ./register-paths.cjs \
  ./dist/apps/commands/src/main.js storage:local-to-s3 inventory
pnpm exec dotenv -e ../../.env -- node -r ./register-paths.cjs \
  ./dist/apps/commands/src/main.js storage:local-to-s3 copy
pnpm exec dotenv -e ../../.env -- node -r ./register-paths.cjs \
  ./dist/apps/commands/src/main.js storage:local-to-s3 verify
```

- `inventory` counts regular files and reports symlinks/non-regular files without writing objects.
- `copy` streams identical relative keys with bounded concurrency, retries, and a resumable SHA-256 manifest. It never deletes or overwrites an unrelated destination object.
- `verify` hashes both source and streamed destination bytes. Do not cut over unless it reports zero missing/mismatched files. Unexpected destination objects are reported separately.
- Repeat `copy` and `verify` immediately before cutover to catch files written during the first pass.

Set `STORAGE_PROVIDER=s3` and restart both backend and frontend. Verify old `/uploads` redirects, new tenant-prefixed uploads, video range requests, Designer exports, deletion, and any existing BYO mounts. Run the delta `copy`/`verify` once more.

For rollback, run `storage:local-to-s3 copy-back` to copy post-cutover objects into the local tree, then set `STORAGE_PROVIDER=local` and restart both services. The command refuses to overwrite a divergent local file and never deletes bucket objects.

Local cleanup is deliberately not automated. After explicit operator confirmation, remove only files whose current local hashes still match the verified manifest and bucket copies, and retain the manifest plus bucket versioning/backups.

## Health tracking

A storage provider's health is recorded whenever its connection is tested — when the config is
created and whenever an org admin runs a connection test (there is no scheduled background check):

- `lastHealthCheck` timestamp is updated on each test
- `lastHealthError` captures the error message if connection fails
- The UI shows a green/amber/red badge with "Last checked: `<time>`"

Health checks verify the provider is reachable and the credentials are valid.

## Folder-level provider routing

In Settings -> Storage, an org admin can assign a storage provider to a specific folder
(`defaultFolderId`). All uploads targeting that folder will automatically use that provider. If
a folder has no assigned provider, the system picks any mounted provider.

## Large file uploads

Large media files (up to `MEDIA_UPLOAD_MAX_BYTES`, default 1 GB) are uploaded through
`/files/upload-server` using XHRUpload (streamed to disk). If an S3/R2 provider is configured for
media-library uploads, large files go through the backend as well.

## Canvas CORS (Designer)

The native **Designer** renders images onto an HTML canvas and exports via Konva's
`toBlob`/`toDataURL`. The browser **taints** a canvas that has drawn a cross-origin image without
CORS, and a tainted canvas throws `SecurityError` on export. So when designs include media served
from external object storage (S3/R2/B2/e2), that bucket must return permissive CORS headers:

```
Access-Control-Allow-Origin: <your app origin>   # or *
Access-Control-Allow-Methods: GET, HEAD
```

The Designer loads element images with `crossOrigin="anonymous"`. If a bucket cannot be configured
for CORS, the Designer falls back to the same-origin image proxy (`GET /media/designer/proxy`),
which is org-bound, fetches through `safeFetch`, fails closed on non-image content, and is
size-capped. `LOCAL` storage is same-origin and needs no CORS.

## Related

- [Configuration](./configuration.md) — all storage env vars
- [Requirements](./requirements.md) — object storage options
- [Designer](../developer-docs/designer.md) — editor architecture & endpoints

> Verified against v1.4.0
