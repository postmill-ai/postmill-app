# Upgrading

## Clean upgrade path

The recommended upgrade process follows the immutable-infrastructure model: new container image,
same data volumes.

```
1. Read CHANGELOG → 2. Back up → 3. Bump image tag → 4. Redeploy → 5. Apply migrations → 6. Set new env vars
```

### 1. Read the CHANGELOG

Before every upgrade, read `CHANGELOG.md` at the new version tag. Note:

- **Breaking changes** — env var renames, Docker identifier changes, config relocation
- **New required env vars** — boot will fail if missing
- **Schema changes** — additive columns are safe; renames/drops need a manual plan

### 2. Back up

Take a full backup before every upgrade. See [Backup & Retention](./backup-and-retention.md).

```bash
docker exec postmill-postgres pg_dump -U postmill-user postmill-db-local > pre_upgrade_$(date +%Y%m%d).sql
```

### 3. Bump the image tag

```yaml
# docker-compose.yaml or your deployment config
services:
  postmill:
    image: ghcr.io/postmill-ai/postmill-app:v1.4.0  # pin a specific tag, not :latest
    # image: postmillai/postmill-app:v1.4.0         # the same image on Docker Hub
```

Pinning specific tags gives you a known rollback target. Using `:latest` means every restart may
pull an untested version. Both registries carry the same release — see
[Container images](./docker.md#container-images).

### 4. Redeploy

```bash
# Docker Compose
docker compose pull postmill
docker compose up -d postmill

# Coolify / Portainer / Kubernetes
# Trigger a redeploy of the postmill service with the new image tag
```

### 5. Apply migrations

The Prisma client is generated at image build time to match the schema baked into the new image;
the container does **not** apply committed migrations automatically.

Postmill ships committed Prisma migrations under
`libraries/nestjs-libraries/src/database/prisma/migrations/`. The canonical apply path is
`prisma migrate deploy`:

```bash
# Run inside the running container, using the Prisma CLI already installed in the image
# (pnpm is not installed in the runtime image; no download needed)
docker exec -w /app postmill node_modules/.bin/prisma migrate deploy \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

For a quick local reset only, you can use `pnpm run prisma-db-push` / `pnpm run prisma-reset`. Never
use `db push` against a shared or production database.

If a release includes destructive changes (column/table drops, in-place renames), read the
CHANGELOG carefully, take a backup, and follow the expand-contract path documented in
[Database](../developer-docs/database.md).

### 6. Set new env vars

Check the CHANGELOG for any new env vars required by the release. Add them to your `.env` file,
Docker Compose environment, or deployment config, then redeploy if needed.

## v1.4.0

- **Migrations.** v1.4.0 adds one migration, `20261021000000_design_version_creator_setnull`. It only relaxes `DesignVersion.createdById` to nullable and re-creates its foreign key with `ON DELETE SET NULL`, so design versions a deleted member saved on teammates' designs survive with `createdById = NULL`. It drops and re-adds a constraint but deletes no rows; `ALLOW_DESTRUCTIVE_SCHEMA` is not needed.
- **No new required env vars.** Two optional Sentry tunables are new:
  - `SENTRY_TRACES_SAMPLE_RATE` (backend) — production default `0.2` (was 1.0).
  - `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (frontend) — production default `0.25` (was 1.0). Like `NEXT_PUBLIC_SENTRY_DSN`, it is baked in at build time, so a change needs a frontend rebuild.
  - Both accept `0`–`1`; anything else falls back to the default, and development always samples at 1.0.
- **fal Kling defaults are rewritten on first boot.** The ledger-gated backfill `fal Kling default models` runs once and rewrites organization media defaults for the `fal` provider that still point at `fal-ai/kling-video/v1.6/standard/*`, `fal-ai/kling-video/v1.6/pro/*` or `fal-ai/kling-video/v2/master/*` (text-to-video and image-to-video) to `fal-ai/kling-video/v2.5-turbo/pro/<operation>`. In-flight jobs are not touched. No manual step.
- **Media routes.** `/media/kling` now redirects to the new fal.ai studio at `/media/fal`; the provider card that was labelled **Kling** is now **fal.ai** (same `fal` identifier and key, nothing to re-enter). The new direct **Kling AI** provider at `/media/kling-ai` needs its own klingai.com API key under **Settings → Content → AI Media → Kling AI**. `/media/pika` is unchanged and still uses the fal.ai key. Update any bookmarks or proxy path allowlists that named `/media/kling`.
- **Rebuild the render image when using Podman renders.** `docker/Containerfile.render` itself is unchanged, but it compiles the whole backend into the image and the frame renderer changed: it now honours the clip `mediaType` hint, so extensionless AI-generated videos render as video in exports instead of a static first frame. A stale `localhost/postmill-render:latest` keeps the old behaviour.
- **Reverse-proxy body size.** `.pdesign` imports (`POST /media/designs/import`, `POST /federation/install-template`) accept up to 1 GB and are disk-spooled. A proxy with a smaller body limit returns 413. The bundled nginx configs allow 2 GB.
- **Video seeking uses range requests.** Designer render assets (`GET /media/designs/render-asset/:jobId/:file`) answer HTTP `Range` requests with 206. A proxy that strips `Range` or `Accept-Ranges` headers breaks seeking in the Designer.
- **Repair black design thumbnails after upgrading.** `POST /media/designs/maintenance/regen-previews` now backfills missing video thumbnails, reclassifies legacy media rows and regenerates previews; it accepts optional `designIds`, `templateIds` and `forceSourceThumbnails` for a targeted repair. Run it once per affected organization if designs showed black thumbnails on 1.3.0.
- **Sentry volume changes.** Uncaught controller 500s are now reported to Sentry (they were not before), so expect issues that were previously invisible. Provider upstream errors return the 502 `ProviderUpstreamError` envelope again, and account-explained kinds (quota, billing, bad key) no longer create Sentry issues.
- **Postmill ID federation.** A first write-capable scope, `templates:install`, and `POST /federation/install-template` exist for trusted template stores. The scope is never granted unless a client asks for it and the user consents; existing clients are unaffected.
- **Setup completion is role-checked.** `POST /settings/setup/complete` requires `settings:update`; owners and admins are unaffected.

## v1.3.0

- **Migrations.** v1.3.0 adds three migrations. None are destructive and none need `ALLOW_DESTRUCTIVE_SCHEMA`.
  - `20261015201234_design_template_folders` adds the `DesignTemplateFolder` table and a nullable `DesignTemplate.folderId`.
  - `20261017225024_design_versions` adds the `DesignVersion` table.
  - `20261020200424_drop_null_model_media_defaults` is a data-only, idempotent delete. It removes media model defaults that were stored without a model; those organizations fall back to an automatic pick.
- **No new required env vars.** Optional tunables are listed in [Configuration](./configuration.md) and [Video rendering](./video-rendering.md): `VIDEO_RENDER_CAPTURE_PAGES`, `VIDEO_RENDER_FRAME_TIMEOUT_MS`, `BLANK_DESIGN_RETENTION_DAYS`, `DESIGN_VERSIONS_KEEP_AUTO`, `DESIGN_VERSIONS_KEEP_NAMED` and `AI_DESIGNER_SCENE_VIDEO_TIMEOUT_MS`.
- **Rebuild the render image when using Podman renders.** The frame-capture code changed, so a stale `localhost/postmill-render:latest` keeps the old behaviour. Video renders can now run up to 180 s. Long renders capture with several Chromium pages, which uses more RAM; set `VIDEO_RENDER_CAPTURE_PAGES=1` for sequential capture. Containers no longer use swap, so size `VIDEO_RENDER_MEMORY` accordingly. The backend downloads remote clips before a render, so it needs temp-dir space and outbound HTTPS. See [Video rendering](./video-rendering.md).
- **Reverse-proxy body size.** Design saves can send JSON bodies up to 50 MB. A proxy with a smaller body limit returns 413 on large designs. The bundled nginx allows 2 GB.
- **Storage.**
  - New cloud storage configurations mount automatically once their connection test passes.
  - Moving a file to a folder on another provider copies its bytes.
  - Cloudflare R2 and MediaLocker configurations need a **Public URL** to pass the connection test. Existing configurations without one keep serving their files but report a health error, so add the Public URL in **Settings → File Storage**.
- **Member role.** The boot-time seeder grants the member role `media:update` and `media:delete`; no manual step is needed.
- **Sora removed.** The Sora studio (`/media/sora`) is gone because OpenAI retired the API.
- **Role checks tightened.** Routes that were only billing-gated now also check the member's role, so each role gets exactly what it is defined to allow:
  - **Viewers** (read-only) can no longer use the Postmill agent, AI media generation, custom font upload/delete, or create autoposts or webhooks.
  - **Members** can no longer create autoposts or webhooks, matching the update and delete routes they never had.
  - Owners, admins and editors are unaffected.
- **MCP `allowedScopes` is now a ceiling.** It limits the scopes a token can use instead of being required of every token, so read-only tokens keep working when write scopes are allowed.
- **Bulk CSV import validates every row.** Rows for channels that need settings a CSV can't carry, such as a Pinterest board or a YouTube title, now fail at import instead of at publish. `media_url` is imported into the media library and attached.
- **`tools/db/postmill-migrate.sh`** now runs `prisma migrate deploy` with the Prisma CLI bundled in the image, against the `postmill` container. It no longer runs `db push --accept-data-loss`.

## v1.2.0

v1.2.0 has no schema migrations and no new required env vars. Pull the new tag and redeploy.

- **AI Designer needs a text-to-image default.** A run is blocked unless a `media/text-to-image`
  model default is set under **Settings → AI → Model Defaults**. For reference images to guide
  generation, also set a `media/image-to-image` default.
- **R2 storage requires an endpoint.** Saving an R2 storage configuration without one now returns
  HTTP 400 instead of storing a broken configuration.

## v1.1.0

v1.1.0 adds four non-destructive migrations: `20260921130000_add_org_ai_budget_columns`,
`20260921160000_payments_provider_domain`, `20260921190000_payments_manual_provider_backfill` and
`20260923094158_postmill_id_federation`. None of them need `ALLOW_DESTRUCTIVE_SCHEMA`. The payment
provider of existing organizations and subscriptions is backfilled automatically. Payment
providers other than Stripe (`PAYPAL_*`, `APPLE_IAP_*`, `GOOGLE_PLAY_*`, `PAYMENTS_PROVIDER`) and
Postmill ID (`FEDERATION_TRUSTED_REDIRECT_URIS`) are opt-in. See the CHANGELOG for details.

## v1.0.0

v1.0.0 ships with zero legacy support. Note these points when upgrading into it:

- **Destructive migration** — `20260830180000_no_legacy_v1` drops the `AIProviderConfig` and
  `ProviderConfiguration` tables, the `AISystemSettings` columns
  `activeProvider`/`activeModel`/`scopeModels`/`rateLimitSettings`, and the `UserProfile`
  columns `sendSuccessEmails`/`sendFailureEmails`/`sendStreakEmails`. It also removes
  `mastra_ai_spans`/`mastra_evals` from the Prisma schema (Mastra still owns those tables at
  runtime). `migrate deploy` applies it unconditionally; `ALLOW_DESTRUCTIVE_SCHEMA=true` is only
  needed to pass the destructive-schema guard (`pnpm run prisma-schema-check` / CI) when you diff
  it yourself. **Take the pre-upgrade `pg_dump` first** — rollback means restoring that backup.
- **Automatic backfills** — no manual data steps are needed. A ledger-gated boot step
  (`backfill:legacy secret re-encryption`) re-encrypts any secrets stored under an older
  encryption format to AES-256-GCM `v2:` — now the only accepted ciphertext — before strict
  reads matter, and the migration backfills `Integration.providerConfigId`. Let the first
  boot of the new image complete before putting the instance under load.
- **Deprecated env-var warnings removed** — the boot configuration checker no longer warns
  about deprecated environment variables (the warning lists were deleted). Fatal guards for
  missing required secrets still apply.

## Manual schema sync

From a source checkout, the helper script runs step 5's `prisma migrate deploy` inside the running
container for you, using the Prisma CLI already installed in the image (no download):

```bash
# Container name defaults to `postmill` (docker-compose.yaml); override with POSTMILL_CONTAINER
./tools/db/postmill-migrate.sh
```

> **Back up before applying a release that ships a destructive migration.** See
> [Backup & Retention](./backup-and-retention.md) and
> [Database schema safety](../developer-docs/database.md).

### Schema change rules

Releases follow additive-schema-only rules so `migrate deploy` against a live database usually
works without data loss:

- New tables are always safe
- New columns are nullable or defaulted — safe
- Renames/drops are destructive and uncommon — noted prominently in the CHANGELOG when they occur

### Renames and drops — expand-contract

A destructive migration drops or renames a column/table and loses data. Never rename or drop a
column or table in the same release that stops using it. Instead, spread the change across releases:

1. **Expand** — add the new nullable column alongside the old one and deploy.
2. **Backfill** — copy data from the old column to the new one (add a one-time step to
   `BackfillService`, `libraries/nestjs-libraries/src/database/seeds/backfill.service.ts`).
3. **Switch** — point all reads and writes at the new column and deploy.
4. **Contract** — only once nothing references the old column (prove it with a grep) drop it in a
   later release, after taking the pre-migration `pg_dump`.

### Rollback

Migrations are forward-only. To roll back a destructive change, restore the pre-upgrade `pg_dump`:

```bash
# Stop the app first so nothing writes during the restore
cat pre_upgrade_YYYYMMDD.sql | docker exec -i postmill-postgres \
  psql -U postmill-user -d postmill-db-local
```

Then redeploy the previous image tag.

### Drift check

After deploying, confirm the live database matches the committed schema. `prisma migrate diff`
exits `2` when there is a difference, `0` when there is none:

```bash
pnpm exec prisma migrate diff \
  --from-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --to-url "$DATABASE_URL" \
  --exit-code
```

The `mastra_*` tables are created at runtime by the Mastra chat agent, outside the Prisma schema,
so they always appear as out-of-schema drift — that is **expected noise**, not a real diff.

## Building from source

If you prefer to build the container image locally:

```bash
# Build the image
./docker/docker-build.sh

# Or with the dev compose stack for local development
docker compose -f docker/docker-compose.dev.yaml up -d

# Build all apps from source
pnpm run build
```

## Rollback

If an upgrade causes issues:

1. Set the image tag back to the previous version.
2. Redeploy.
3. Restore the database from the pre-upgrade backup if the upgrade applied destructive schema
   changes.

## Related

- [Backup & Retention](./backup-and-retention.md) — backup before upgrade
- [Developer Docs: Database](../developer-docs/database.md) — schema management and safety

> Verified against v1.4.0
