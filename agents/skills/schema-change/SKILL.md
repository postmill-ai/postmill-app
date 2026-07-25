---
name: schema-change
description: Change the Prisma schema safely — add/rename/drop a model, column, or enum and author a backward-compatible migration. Use when editing schema.prisma, adding a Prisma model/column/enum value, writing a database migration, or adding a new repository domain.
---

# Schema Change

Prisma 6.5.0 + PostgreSQL. Migrations apply against the live production DB, so every schema change must be backward-compatible and travel with a committed migration.

## Read first
- `agents/database.md` — full migration workflow, safety rules, CI gates (ordered)
- `agents/backend.md` — repository/service convention (only repositories touch Prisma)
- `agents/testing.md` — test commands for the nestjs-libraries package

## Procedure
1. Edit `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (89 models — read it for ground truth).
2. `pnpm run prisma-migrate-dev` — authors `migrations/<timestamp>_<name>/migration.sql` and applies it to the local dev DB. It does **not** git-commit; commit the migration directory yourself, in the same commit as the schema edit.
3. `pnpm run prisma-schema-diff` — eyeball the SQL production will run (detail: `agents/database.md` § Scripts).
4. `pnpm run prisma-schema-check` — pipes the diff through `scripts/schema-destructive-guard.mjs`. Flags `DROP TABLE`, `DROP COLUMN`, `DROP CONSTRAINT`, `ADD COLUMN ... NOT NULL` without `DEFAULT`.
5. `pnpm run prisma-generate` — sync the client (also runs on postinstall).
6. Commit schema + migration together. **A schema edit without its migration fails CI**: `.github/workflows/test.yml` applies committed migrations to an empty Postgres and runs `prisma migrate diff --exit-code` against the schema; divergence = failure (detail: `agents/database.md` § CI gates).
7. Other environments apply via `pnpm run prisma-migrate-deploy` (or the P3005-recovery wrapper `pnpm run prisma-migrate-deploy-safe`). `migrate deploy` is the **only** apply path for shared/production DBs; `pnpm run prisma-db-push` bakes in `--accept-data-loss` and is local-prototyping/reset only.

Compatibility rules:
- New columns on populated tables: **nullable or with a `DEFAULT`**. Required-without-default breaks the live apply and trips the guard.
- Renames/drops: expand-contract — add new shape + dual-write, deploy readers of the new shape, drop the old shape in a **later** migration (separate release). Land a reviewed destructive change with `ALLOW_DESTRUCTIVE_SCHEMA=true` (CI: repo variable) to clear the guard.
- Enum values can be added (`ALTER TYPE ... ADD VALUE`), never removed without destructive type recreation.

Provider enum additions (detail: `agents/database.md` § Enum additions):
- Storage providers: extend `enum StorageProviderType` (schema.prisma:815). Precedent: `migrations/20260714150606_add_medialocker_storage_type/migration.sql` — one line `ALTER TYPE "StorageProviderType" ADD VALUE 'MEDIALOCKER';`. See `agents/providers/storage.md`.
- Login providers: extend `enum Provider` (schema.prisma:1621); follow the medialocker pattern. See `agents/providers/auth.md`.
- AI/media/shortlink/VPN/content-pack/email key config rows on string ids — no enum change.

New repository domain (detail: `agents/backend.md` § 4 Recipe: add a repository / domain):
- Create `libraries/nestjs-libraries/src/database/prisma/<domain>/` with `<model>.repository.ts` + `<model>.service.ts` (naming follows the model, e.g. `organizations/organization.repository.ts`, `users/users.repository.ts`), built on `PrismaService` / `PrismaRepository<T>` / `PrismaTransaction` from `database/prisma/prisma.service.ts`.
- Register both in `database/prisma/database.module.ts`. Only repositories touch Prisma; cross-domain access goes through the other domain's service.

## Verify
```bash
pnpm run prisma-schema-diff      # review SQL
pnpm run prisma-schema-check     # destructive guard passes
pnpm run prisma-generate         # client in sync
vitest run --root libraries/nestjs-libraries
```
CI must be green: `Test` workflow migration-drift check + destructive-guard step.

## Pitfalls
- Committing the schema edit without the migration directory (or vice versa) — the CI drift gate fails.
- Adding a required column without a default on a populated table — breaks the production apply mid-deploy.
- Running `db push` on a shared/production DB — the script bakes in `--accept-data-loss`; it is a local-only tool.
- Forgetting `pnpm run prisma-generate` after the edit — the client and schema drift silently until typecheck.
- Doing a rename as drop+add in one migration — that is destructive; use expand-contract across two releases.
- Calling Prisma from a service or controller — only `*.repository.ts` touches Prisma (sanctioned exceptions: `agents/backend.md`).
