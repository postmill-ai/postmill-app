# Schema rollback

Schema changes apply through committed Prisma migrations (`pnpm run prisma-migrate-deploy` — see
[Database](../developer-docs/database.md)). `migrate deploy` is **forward-only**: it never reverses an
applied migration. There is no `migrate down`. Rolling back is therefore an act of **rolling
forward** — you author a new migration that undoes the change — plus, when a deploy fails partway, a
manual recovery step.

## 1. Roll back by authoring a new (contract/down) migration

To undo a migration that has already been applied to a shared/production database:

1. **Never edit the applied migration's SQL.** Prisma records each migration's checksum; editing
   applied SQL makes `migrate deploy` fail on a checksum mismatch.
2. Revert the change in `schema.prisma` (e.g. restore the dropped column, remove the new model).
3. Author a fresh migration capturing that reversal:

   ```bash
   pnpm run prisma-migrate-dev      # creates migrations/<timestamp>_revert_<name>/migration.sql
   ```

4. Review the generated SQL (this is the "down"/contract step), commit it, and ship it the normal
   way — `pnpm run prisma-migrate-deploy` applies it in order on every environment.

Reversing a destructive change (a `DROP`) cannot recover dropped data — the forward migration already
deleted it. The reversal only restores the *shape*; backfill the data from a backup if needed (see
[Backup & retention](./backup-and-retention.md)).

## 2. Recover a half-applied (failed) migration

If `migrate deploy` fails midway, Prisma marks that migration **failed** in `_prisma_migrations` and
**refuses to apply anything further** until you resolve it. You have two recovery routes:

- **The migration did NOT change the DB** (or you manually reverted its partial effects) — mark it
  rolled back so Prisma forgets it, fix the migration SQL, then redeploy:

  ```bash
  # wraps `prisma migrate resolve --rolled-back <migration_name>`
  pnpm run prisma-migrate-resolve --rolled-back <migration_name>
  pnpm run prisma-migrate-deploy
  ```

- **The migration's effect is actually fully in place** (e.g. it failed on a late, idempotent
  statement) — mark it applied instead:

  ```bash
  pnpm run prisma-migrate-resolve --applied <migration_name>
  ```

`<migration_name>` is the migration **directory name** (e.g. `20260628120000_add_widget_table`).
Always **take a snapshot before** intervening (see
[Backup & retention](./backup-and-retention.md)).

## 3. Destructive changes: expand → migrate → contract

Never drop or rename in a single migration on a live DB. Split it across releases so each migration is
independently safe and each can be rolled back by rolling forward:

1. **Expand** — add the new column/table/shape (nullable or defaulted). Backward-compatible; old code
   keeps working.
2. **Migrate** — backfill data and switch every reader/writer to the new shape. Deploy and verify.
3. **Contract** — only once nothing references the old shape, author the migration that drops it.

The contract step is the only destructive one, and it is gated: the diff must pass
`scripts/schema-destructive-guard.mjs` (run via `pnpm run prisma-schema-check`), which **rejects**
`DROP TABLE`/`DROP COLUMN`/`DROP CONSTRAINT` and `ADD COLUMN … NOT NULL` without a `DEFAULT` unless
explicitly acknowledged with `ALLOW_DESTRUCTIVE_SCHEMA=true`. CI runs the same guard against
`origin/main` on every PR. See the
[Schema-Change Workflow](../developer-docs/database.md#schema-change-workflow) for the full sequence.

> Take a database snapshot immediately before any contract (destructive) deploy. That snapshot is
> the *only* path back to dropped data — the forward "rollback" migration restores structure, not
> rows.

> Verified against v1.0.0
