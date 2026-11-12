# Backup & Retention

Postmill keeps all application state in PostgreSQL and uploaded media on local disk or object storage. Schema changes are applied through committed Prisma migrations (`pnpm run prisma-migrate-deploy`, or `prisma migrate deploy` inside the container — the container does not migrate on boot; see [Upgrading](./upgrading.md#_5-apply-migrations)). Backups are still essential: rollback is forward-only, and a failed or destructive migration is only recoverable from a snapshot.

## What to back up

### 1. PostgreSQL database

The primary data store. Contains users, organizations, posts, integrations, tokens, analytics snapshots, comments, and all configuration.

```bash
# From the Docker host
docker exec postmill-postgres pg_dump -U postmill-user postmill-db-local > postmill_$(date +%Y%m%d).sql

# Or with a connection string
pg_dump "$DATABASE_URL" > postmill_$(date +%Y%m%d).sql
```

Schedule this daily. Keep at least 7 days of backups.

### 2. Upload directory or object storage

All uploaded media (images, videos, audio). If using local storage, back up the volume. Docker Compose prefixes volume names with the project name (the directory holding `docker-compose.yaml`, `postmill-app` for a default clone) — confirm yours with `docker volume ls` and adjust the commands below:

```bash
# From the Docker host
docker run --rm -v postmill-app_postmill-uploads:/data -v $(pwd):/backup alpine tar czf /backup/uploads_$(date +%Y%m%d).tar.gz -C /data .
```

If using cloud object storage (R2, S3, B2, IDrive e2, or another S3-compatible provider), enable versioning and/or cross-region replication on the bucket.

**Platform S3 base (`STORAGE_PROVIDER=s3`).** The platform bucket named by `S3_BUCKET` then holds avatars, generated media and every organization's root and unmounted uploads, partitioned as `<tenantId>/...`. Back it up the same way: turn on bucket versioning and replicate or snapshot it with your provider's tooling. The uploads volume still matters in S3 mode. It is the source for `storage:local-to-s3` and the destination for `copy-back`. In the published image, nginx also serves legacy `/uploads/...` URLs from it. Keep backing it up until you have deliberately retired the local copies.

**Storage-migration manifests.** `storage:local-to-s3` keeps a resumable SHA-256 manifest (`manifest.json`) in `STORAGE_MIGRATION_DIRECTORY`. Without that variable, the manifest goes in the system temp directory (`postmill-storage-migration`). Point it at a persistent directory outside the upload root and the repository, and keep the manifest with your backups. Any later manual cleanup of local files should be checked against it. See [Storage → Platform local-to-S3 migration](./storage.md#platform-local-to-s3-migration).

### 3. JWT_SECRET and ENCRYPTION_KEY

These secrets encrypt OAuth tokens, AI provider credentials, storage credentials, and other secrets at rest. **If you lose them, every encrypted value in the database becomes unrecoverable.** Store them:

- In a password manager or secrets vault
- In a `.env` file with restricted permissions, outside the backup bundle
- Never in the database backup alone — if you restore to a fresh instance with a different `JWT_SECRET`, all tokens will fail to decrypt

## What not to back up

- **Redis** — cache only; data is rebuilt on restart. AOF/RDB persistence is useful for avoiding cold-cache latency but is not a backup.
- **node_modules** or build artifacts.
- **The organization-archive spool** (`ORG_PORTABILITY_SPOOL_DIR`, default `${TMPDIR}/postmill-org-archives`). It holds encrypted export and import archives only briefly: a completed export is kept for 24 hours after it finishes, and a running job is cleaned up only after 24 hours with no progress. The hourly `org-portability-expiry` function then marks the job expired and deletes the file. The spool is ephemeral by design. An owner who loses an in-flight archive just requests a new export. Do not copy it into backups, where an encrypted archive would outlive its expiry.

## Automated data retention

Postmill prunes and rolls up data through Inngest scheduled functions. You do not need to run manual cleanup queries.

| Data | Default retention | Mechanism | Env var |
|------|-------------------|-----------|---------|
| Daily `AnalyticsSnapshot` rows | 548 days (~18 months) | Rolled into weekly rows by the analytics collection function | `ANALYTICS_DAILY_RETENTION_DAYS` |
| `PostAnalyticsSnapshot` rows | 90 days | Pruned by the analytics collection function | `ANALYTICS_POST_RETENTION_DAYS` |
| Social comments | 90 days | Soft-deleted by the comments collection function | `SOCIAL_COMMENT_RETENTION_DAYS` |
| Email log metadata | 90 days | Pruned by the analytics collection function | `EMAIL_LOG_RETENTION_DAYS` |
| `Errors` rows | 90 days | Pruned by the retention-purge function | `ERRORS_RETENTION_DAYS` |
| Notifications | 180 days | Hard-deleted by the retention-purge function | `NOTIFICATIONS_RETENTION_DAYS` |
| Incomplete multipart uploads | 7 days | Hard-deleted by the retention-purge function | `MULTIPART_UPLOAD_RETENTION_DAYS` |
| Mastra traces/scorers | 30 days | Hard-deleted by the retention-purge function | `MASTRA_TRACE_RETENTION_DAYS` |
| Soft-deleted posts/files/design versions | 30 days | Hard-purged by the retention-purge function | `SOFT_DELETE_RETENTION_DAYS` |
| AI Designer chat sessions | 90 days | Hard-deleted by the retention-purge function (which also soft-deletes the session's intermediate asset/reference files not referenced by a delivered design) | `AI_DESIGNER_SESSION_RETENTION_DAYS` |
| Blank canvases | 1 day | Soft-deleted by the retention-purge function: never-customized `Untitled Design` rows whose doc is content-free, with their preview files | `BLANK_DESIGN_RETENTION_DAYS` |
| Designer version history | Newest 10 automatic + 20 named snapshots per design | Older snapshots trimmed when a new one is saved | `DESIGN_VERSIONS_KEEP_AUTO` / `DESIGN_VERSIONS_KEEP_NAMED` |
| User/Session IP and agent | 90 days | Nulled by the retention-purge function | `IP_RETENTION_DAYS` |
| Organization export/import archives | 24 hours after a completed export finishes; running jobs after 24 hours with no progress | Job marked `expired` and spooled archive deleted by the hourly `org-portability-expiry` function | — (fixed) |

See [Inngest & Cron](./inngest-and-cron.md) for how the functions operate.

## Why backups are critical

Postmill's schema is managed with committed Prisma migrations:

- `pnpm run prisma-migrate-deploy` applies migrations in order and is forward-only.
- Adding a nullable or defaulted column is safe.
- Renaming or dropping a column is destructive and should be done as a contract step in an expand/contract plan.
- The destructive-diff guard (`tools/db/schema-destructive-guard.mjs`, run by `pnpm run prisma-schema-check` and the CI schema gate — not by `migrate deploy`) rejects `DROP TABLE`/`DROP COLUMN`/`DROP CONSTRAINT` and `ADD COLUMN … NOT NULL` without a default unless `ALLOW_DESTRUCTIVE_SCHEMA=true`.

`prisma db push` is for local prototyping only. The `tools/db/postmill-migrate.sh` helper runs `prisma migrate deploy` inside a running container (never `db push`). Always back up before any manual schema operation or contract deploy.

## Restore checklist

1. **Stop the application** — prevent write traffic during restore.
2. **Restore Postgres**:
   ```bash
   docker exec -i postmill-postgres psql -U postmill-user postmill-db-local < postmill_20260609.sql
   ```
3. **Restore uploads**:
   ```bash
   docker run --rm -v postmill-app_postmill-uploads:/data -v $(pwd):/backup alpine tar xzf /backup/uploads_20260609.tar.gz -C /data
   ```
4. **Verify `JWT_SECRET` and `ENCRYPTION_KEY`** match the values from the backup:
   - If you changed `JWT_SECRET` since the backup, all encrypted tokens will fail to decrypt.
   - Test by logging in and checking that connected channels still work.
5. **Start the application** and verify:
   - Users can log in.
   - Channels are connected (no auth errors).
   - Uploaded media is accessible.
   - Inngest functions are registered and scheduled runs appear in the dashboard.
6. **Take a fresh post-restore backup**.

## Backup automation example

```bash
#!/usr/bin/env bash
# /etc/cron.daily/postmill-backup
set -euo pipefail
BACKUP_DIR="/var/backups/postmill"
DATE=$(date +%Y%m%d-%H%M)
mkdir -p "$BACKUP_DIR"

docker exec postmill-postgres pg_dump -U postmill-user postmill-db-local > "$BACKUP_DIR/db_$DATE.sql"
docker run --rm -v postmill-app_postmill-uploads:/data -v "$BACKUP_DIR":/backup alpine tar czf "/backup/uploads_$DATE.tar.gz" -C /data .

# Keep 7 days
find "$BACKUP_DIR" -name '*.sql' -mtime +7 -delete
find "$BACKUP_DIR" -name '*.tar.gz' -mtime +7 -delete
```

> Verified against v1.5.0
