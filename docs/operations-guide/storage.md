# Storage Setup

Postmill supports multiple storage backends for uploaded media: local disk, Cloudflare R2, AWS S3,
Backblaze B2, and IDrive e2. Each organization can mount its own storage provider independently,
configured from the in-app Settings -> Storage page.

**v3.8.3:** **LOCAL** is the always-on base storage that every org has. Other providers
(S3/R2/B2/IDriveE2) mount onto this base — there is no default provider. New uploads always land
on LOCAL first. Cloud providers are configured per-organization in-app; the old global-env
`STORAGE_PROVIDER`/`CLOUDFLARE_*` path has been removed.

**v3.8.10:** local storage is **partitioned per tenant** (`<UPLOAD_DIRECTORY>/<tenantId>/`), the
default local quota is driven by the `LOCAL_STORAGE_QUOTA_GB` env var (default 5), each provider
config must be a **unique account** (credential fingerprint), and the Settings → Storage UI was
rebuilt to mirror the AI page (including a fix for the first-load render inconsistency).

## Storage model

### `StorageProviderConfig`

Each storage provider mount is a row in the `StorageProviderConfig` table:

| Field | Description |
|-------|-------------|
| `type` | One of `LOCAL`, `S3`, `CLOUDFLARE_R2`, `BACKBLAZE_B2`, `IDRIVE_E2` |
| `name` | User-facing label |
| `mounted` | Whether this provider is actively serving files |
| `credentials` | Encrypted JSON: `accessKeyId`, `secretAccessKey`, `endpoint`, `region` |
| `bucket` | Bucket name (for S3-family providers) |
| `publicUrl` | Public base URL for file access |
| `quotaBytes` | Per-provider byte limit (null = use org quota) |
| `lastHealthCheck` | Timestamp of last connection test |
| `lastHealthError` | Error message from last failed connection test |
| `defaultFolderId` | Folder-level routing: uploads to this folder use this provider |
| `accountFingerprint` | **(v3.8.10)** SHA-256 of the distinguishing credentials (provider type + access-key ID). Unique per org — the same account cannot be added twice. |

> **v3.8.3:** `StorageProviderConfig.isDefault` was removed. The `set-default` API route is gone.
> There is no default provider — LOCAL is the always-on base that every org has.

### Per-org quota

Each organization's local storage has a **soft quota**: the default is driven by
`LOCAL_STORAGE_QUOTA_GB` (default `5`, v3.8.10), and each org can carry an explicit override in
`localStorageQuotaBytes` (explicit value wins, else the env default). At 80% usage, a warning
banner appears in the storage settings. At 100%, new uploads are blocked until space is freed or
quota is raised.

## Storage backends

### Local storage (always-on base)

Files are written to `UPLOAD_DIRECTORY` (e.g. `/uploads/`) on the container's filesystem, served
at `/uploads`. Simple but not redundant — a single container's disk, not shared across replicas.
Since v3.8.10, each tenant's files are written under its own partition,
`<UPLOAD_DIRECTORY>/<tenantId>/` (previously date-partitioned only); files uploaded before the
change remain readable at their recorded paths.

Avatars and all app-internal image writes always target LOCAL storage.

```yaml
UPLOAD_DIRECTORY: '/uploads'
MEDIA_UPLOAD_MAX_BYTES: '1073741824'
```

### Cloudflare R2 (per-tenant)

S3-compatible object storage with no egress fees. Configure per-org in Settings → Storage.

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

## Per-org storage management

Operators do not need to manage storage for individual orgs — org admins self-serve via Settings
-> Storage. The four-panel interface provides:

1. **Providers** — Cards showing type, mount status, last health check, usage percentage. Mount
   and unmount buttons.
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

## Health tracking

Each storage provider is periodically health-checked:

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
`/files/upload-server` using XHRUpload (streamed to disk). The pre-v3.8.2 presigned multipart
Cloudflare R2 path has been removed. If an S3/R2 provider is configured for media-library
uploads, large files go through the backend as well.

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

> Verified against v1.0.0
