# Database: Prisma schema & migration workflow

Prisma 6.5.0 (pinned — every script invokes `pnpm dlx prisma@6.5.0` or the workspace-pinned
`pnpm exec prisma`). PostgreSQL. **Production is live with many users — migrations apply
against the production DB at boot, so every schema change must be backward-compatible.**

| Fact | Value |
|---|---|
| Schema | `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (89 models) |
| Migrations | `libraries/nestjs-libraries/src/database/prisma/migrations/` — committed, from the `0_init` baseline |
| Client access | `PrismaService` / `PrismaRepository<T>` / `PrismaTransaction` in `libraries/nestjs-libraries/src/database/prisma/prisma.service.ts` |
| Canonical apply path | `prisma migrate deploy` (CI, backend boot, production) |
| `db push` | **Local prototyping/reset only — never the apply path for a shared/production DB** |

## Scripts (root `package.json`)

| Script | What it does |
|---|---|
| `pnpm run prisma-generate` | Regenerate the Prisma client. Runs automatically via `postinstall`; run it again after every schema edit. |
| `pnpm run prisma-migrate-dev` | `migrate dev` — authors a new migration from your schema edit and applies it to the local dev DB. **It does not git-commit; commit the generated `migrations/<ts>_<name>/migration.sql` yourself.** |
| `pnpm run prisma-schema-diff` | Prints the SQL diff between `$DATABASE_URL` and `schema.prisma` (review before committing). |
| `pnpm run prisma-schema-check` | Pipes that diff through the destructive guard `scripts/schema-destructive-guard.mjs`. |
| `pnpm run prisma-migrate-deploy` | `migrate deploy` — applies committed migrations. |
| `pnpm run prisma-migrate-deploy-safe` | `node scripts/migrate-deploy-safe.mjs` — see below. |
| `pnpm run prisma-migrate-resolve` | `migrate resolve` — mark a failed/rolled-back migration in `_prisma_migrations`. |
| `pnpm run prisma-db-push` | `db push --accept-data-loss` (the flag is baked in — destructive on a non-throwaway DB). Local only. |
| `pnpm run prisma-db-pull` | Introspect an existing DB into `schema.prisma`. |
| `pnpm run prisma-reset` | `db push --force-reset && db push` inside the prisma dir — drop-and-rebuild a local DB. |

## Schema-change recipe

1. Edit `libraries/nestjs-libraries/src/database/prisma/schema.prisma`.
2. `pnpm run prisma-migrate-dev` — generates `migrations/<timestamp>_<name>/migration.sql` and applies it locally.
3. `pnpm run prisma-generate` — sync the client.
4. `pnpm run prisma-schema-diff` — eyeball the SQL that production will run.
5. `pnpm run prisma-schema-check` — destructive guard must pass (see below).
6. Commit **both** the schema edit and the new migration directory together. A schema edit committed without its migration fails the CI drift gate.
7. Other environments pick it up via `pnpm run prisma-migrate-deploy` (or the `-safe` wrapper).

## Safety rules (migrations run against the live production DB)

- New columns: **nullable or with a `DEFAULT`**. `ADD COLUMN ... NOT NULL` without a default breaks the apply on existing rows and is flagged by the guard.
- Renames/drops are destructive. Use expand-contract:
  1. **Expand**: add the new column/table alongside the old; dual-write/backfill.
  2. Deploy code that reads the new shape.
  3. **Contract**: drop the old column in a **later** migration (separate release).
- To land a reviewed destructive change, set `ALLOW_DESTRUCTIVE_SCHEMA=true` (CI: repo variable under Settings → Secrets and variables → Actions → Variables; local: env var) to clear the guard. The guard exits 0 with an override notice.
- Enum values can be **added** (`ALTER TYPE ... ADD VALUE`) but not removed without recreating the type (destructive, manual SQL).

### Destructive guard — `scripts/schema-destructive-guard.mjs`

Reads forward-migration SQL (stdin or `--file`) and flags: `DROP TABLE`, `DROP COLUMN`,
`DROP CONSTRAINT`, `ADD COLUMN ... NOT NULL` without `DEFAULT`. Exit codes: `1` = findings
and no override; `0` = clean or `ALLOW_DESTRUCTIVE_SCHEMA=true`; `2` = empty input
(upstream diff failed).

## CI gates — `.github/workflows/test.yml` (workflow `Test`, job `test`)

Runs against a service container `postgres:17-alpine` (`postmill-local`/`postmill-local-pwd`, db `postmill-db-local`).

1. **Migration drift check** (step `Migration drift check`):
   - `pnpm run prisma-migrate-deploy-safe` applies committed migrations (`0_init` + later) to the empty CI DB.
   - `pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel libraries/.../schema.prisma --exit-code` must exit `0`; exit `2` (divergence) fails the job. A schema edit without a matching migration is caught here.
   - Runtime-only `mastra_*` tables live outside the Prisma schema and cannot appear as drift (app never boots in CI).
2. **Destructive guard vs origin/main** (step `Destructive schema guard (vs origin/main)`): diffs `origin/main`'s `schema.prisma` against the branch schema, pipes to `scripts/schema-destructive-guard.mjs --file`, gated by the `ALLOW_DESTRUCTIVE_SCHEMA` repo variable.

## migrate-deploy-safe vs postmill-migrate.sh

- **`scripts/migrate-deploy-safe.mjs`** (`pnpm run prisma-migrate-deploy-safe`; used by `pm2-run` and CI): `migrate deploy` plus one recovery — on a DB created by the old `db push` workflow (tables present, no `_prisma_migrations` history) a bare deploy aborts with **P3005 "database schema is not empty"**; the wrapper detects P3005, baselines `0_init` via `migrate resolve --applied 0_init`, and re-deploys. One-time, idempotent. Sharp edge: the baseline marks `0_init` applied **without verifying the live DB matches it** — valid only because `0_init` is generated from the current schema and any db-push DB was pushed from that same schema. For a DB pushed from an *older* schema, use `pnpm run prisma-reset` instead.
- **`scripts/postmill-migrate.sh`**: manual, in-place `prisma db push` **inside the running Docker container** (`POSTMILL_CONTAINER`, default `postiz-l4le990xi7me2e4pma11lzma`). Refuses data loss unless passed `--accept-data-loss` (back up first). It pushes whatever schema is baked into the running image; the permanent path is edit → commit → tag → CI image → redeploy. Not part of the normal dev workflow.

## Rollback

No down-migrations. Rollback = expand-contract in reverse: ship a new forward migration
restoring the previous shape. For a migration that failed mid-apply, use
`pnpm run prisma-migrate-resolve` to mark it rolled-back/applied after manual repair.

## Enum additions for new providers

- **Storage providers**: extend `enum StorageProviderType` (schema.prisma:815; currently `LOCAL, S3, CLOUDFLARE_R2, BACKBLAZE_B2, IDRIVE_E2, WASABI, DIGITALOCEAN_SPACES, HETZNER, STORJ, SCALEWAY, VULTR, LINODE, S3_COMPATIBLE, MEDIALOCKER`). Precedent migration: `migrations/20260714150606_add_medialocker_storage_type/migration.sql` — one line: `ALTER TYPE "StorageProviderType" ADD VALUE 'MEDIALOCKER';`. See `agents/providers/storage.md`.
- **Login providers**: extend `enum Provider` (schema.prisma:1621; currently `LOCAL, GITHUB, GOOGLE, FARCASTER, WALLET, GENERIC`). No precedent migration exists yet — follow the medialocker pattern. See `agents/providers/auth.md`.
- Other provider domains (AI/media/shortlink/VPN/contentpack/email) key their config rows on string ids, not enums — no enum change needed. See `agents/providers/overview.md`.

## Access convention

Only repositories touch Prisma — `*.repository.ts` under
`libraries/nestjs-libraries/src/database/prisma/<domain>/`, built on
`PrismaService` / `PrismaRepository<T>` / `PrismaTransaction`
(`database/prisma/prisma.service.ts`). Controllers/services never call Prisma directly;
sanctioned exceptions (seeders, cross-domain leaf-reads) are enumerated in
`agents/backend.md`. Connection-pool tuning via env `DATABASE_CONNECTION_LIMIT` /
`DATABASE_POOL_TIMEOUT` (appended to `DATABASE_URL` by `PrismaService` when set).

## Data model overview (89 models — read `schema.prisma` for ground truth)

| Domain | Key models |
|---|---|
| Identity / RBAC / sessions | `User`, `UserProfile`, `Session`, `AppRole`, `Permission`, `AppRolePermission` |
| Org | `Organization`, `UserOrganization` |
| Channels | `Integration`, `OrgProviderConfiguration` |
| Posts / comments | `Post`, `Comments`, `PostCommentRead`, `Media` |
| Provider configs | `AIOrgProviderConfig`, `MediaProviderConfig`, `StorageProviderConfig`, `OrgShortLinkConfig`, `OrgVpnConfig`, `ContentPackConfig`, `AuthProviderConfig` |
| Billing | `Subscription`, `Credits` |
| Notifications | `Notifications`, `NotificationRead`, `NotificationPreference`, `NotificationDigestQueue` |
| Analytics | `AnalyticsSnapshot`, `PostAnalyticsSnapshot`, `AnalyticsAnomaly`, `AnalyticsAlertRule`, `AnalyticsShare` |
| Webhooks | `Webhooks` |

## Checklist

- [ ] Schema edit accompanied by a committed migration from `pnpm run prisma-migrate-dev` (same commit).
- [ ] `pnpm run prisma-generate` run after the schema edit.
- [ ] `pnpm run prisma-schema-diff` reviewed; `pnpm run prisma-schema-check` clean (or override justified).
- [ ] New columns nullable or defaulted; renames/drops done expand-contract with the contract step in a later migration.
- [ ] No `db push` against a shared/production DB; apply path is `migrate deploy` / `prisma-migrate-deploy-safe`.
- [ ] New storage/login provider: `StorageProviderType` / `Provider` enum value added via `ALTER TYPE ... ADD VALUE` migration.
- [ ] Prisma access only from `*.repository.ts` (see `agents/backend.md` for exceptions).
- [ ] CI `Test` workflow drift gate and destructive-guard step green.
