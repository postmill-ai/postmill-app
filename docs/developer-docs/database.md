# Database

Postmill uses PostgreSQL with Prisma 6.5.0 as the ORM. The schema (`schema.prisma`) is authored in Prisma, and changes are applied through **committed SQL migrations** (`prisma migrate`). A baseline migration (`migrations/0_init`) captures the full pre-migrate schema; every later change ships its own reviewable migration directory.

---

## Schema location

```
libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

---

## Schema application

Schema changes are applied through **committed migrations**:

```bash
# Author a migration from a schema edit (creates migrations/[timestamp]_[name]/migration.sql)
pnpm run prisma-migrate-dev

# Apply committed migrations to a target DB (CI, boot, production)
pnpm run prisma-migrate-deploy
```

`migrate deploy` is the canonical apply path — it runs the committed `migrations/` in order and is what CI, the backend boot (`pm2-run`), and production use. It is **forward-only**; to undo an applied migration you author a new contract/down migration (see [Schema rollback](../operations-guide/schema-rollback.md)).

`prisma db push --accept-data-loss` (`pnpm run prisma-db-push`) is for **local prototyping / a quick reset only** — it diffs the schema straight onto a scratch DB without producing a migration, so it must **never** be the apply path for a shared/production database. `pnpm run prisma-reset` force-resets a local DB the same way. Anything you intend to ship must be captured as a migration via `prisma-migrate-dev`.

After editing the schema, always regenerate the Prisma client:

```bash
pnpm run prisma-generate
```

This also runs automatically after `pnpm install` via a `postinstall` script.

### Baselining an existing database

A database that was created **before migrations existed** (any older local dev DB, or the first production DB stood up via `db push`) already has every table from `migrations/0_init`. A bare `migrate deploy` against it aborts with **P3005 "database schema is not empty"**.

**You normally don't need to do anything** — the canonical apply path used by `pm2-run` and CI is `pnpm run prisma-migrate-deploy-safe` (`scripts/migrate-deploy-safe.mjs`), which detects P3005, auto-baselines `0_init` as already-applied, and re-deploys. It is idempotent and a no-op on a fresh/already-baselined DB.

To baseline manually (e.g. before switching a long-lived DB over by hand):

```bash
pnpm run prisma-migrate-resolve --applied 0_init   # marks 0_init as already-applied
```

Run this **once** per such database, then `pnpm run prisma-migrate-deploy` applies only the migrations authored after the baseline. A fresh/empty DB needs no baseline — `migrate deploy` runs `0_init` itself.

---

## Schema-change safety rules

| Rule | Rationale |
|---|---|
| Add columns as **nullable** or with a **default value** | A new required column without a default breaks `migrate deploy` because existing rows have no value. |
| Never rename columns or tables in-place | `migrate deploy` treats a rename as `DROP old + CREATE new` — data is lost. |
| Unused columns/models should be soft-deprecated (comment + ignore), not dropped | Same reason as above; drops are destructive. |
| Renames/drops need an **expand-contract plan** | Deploy the new column, backfill data, switch reads, then remove the old column in a follow-up. |
| Always test `prisma-generate` after edits | Prevents type mismatches between the client and the schema. |

> **Operator runbook.** The step-by-step backup, expand-contract, rollback, and drift-check procedure for applying schema changes to a live database lives in [Upgrading → Schema changes & rollback](../operations-guide/upgrading.md#schema-changes-rollback).

---

## Schema-change workflow

Every schema edit is captured as a **committed migration** and run through a **reviewable diff + destructive guard**:

```bash
# 1. Edit the schema
$EDITOR libraries/nestjs-libraries/src/database/prisma/schema.prisma

# 2. Author the migration. Creates migrations/[timestamp]_[name]/migration.sql, applies it to
#    your local DB, and regenerates the client. Commit the new migration directory.
pnpm run prisma-migrate-dev

# 3. (Review aid) Generate the exact forward SQL for the destructive guard, and commit it.
#    (Requires DATABASE_URL pointing at a DB that reflects the current/pre-change state.)
pnpm run prisma-schema-diff > dev/schema-changes/[short-description].sql

# 4. Guard the diff — blocks DROP TABLE / DROP COLUMN / DROP CONSTRAINT and
#    ADD COLUMN ... NOT NULL without DEFAULT.
pnpm run prisma-schema-check --file dev/schema-changes/[short-description].sql

# 5. Apply on shared/production DBs via the committed migrations.
pnpm run prisma-migrate-deploy
```

- **`prisma-migrate-dev`** authors and applies the migration locally; the committed migration is the source of truth for what every other environment applies via `prisma-migrate-deploy`.
- **`prisma-schema-diff`** = `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel [schema] --script` — the forward SQL only (no rollback); used to feed the destructive guard.
- **`prisma-schema-check`** runs `scripts/schema-destructive-guard.mjs` (Node, no deps). It reads SQL from `--file [path]` (or stdin) and **exits 1** if it finds `DROP TABLE`/`DROP COLUMN`/`DROP CONSTRAINT` or `ADD COLUMN ... NOT NULL` without a `DEFAULT`.
- **Destructive changes** (drops, in-place renames, a new required column) must follow an **expand/contract** plan — add the new shape, backfill, switch reads/writes, then drop the old shape in a follow-up migration — and the guard must be explicitly overridden with `ALLOW_DESTRUCTIVE_SCHEMA=true` to acknowledge the data-loss risk:

  ```bash
  ALLOW_DESTRUCTIVE_SCHEMA=true pnpm run prisma-schema-check --file dev/schema-changes/[drop].sql
  ```

  The full forward-only [Schema rollback](../operations-guide/schema-rollback.md) playbook covers the expand → migrate → contract sequence and how to recover a half-applied migration.

### CI enforcement

`.github/workflows/test.yml` enforces two gates on every PR:

1. **Migration drift check** — applies the committed migrations to an empty CI Postgres with `prisma-migrate-deploy`, then runs `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel [schema] --exit-code`. It exits 0 only when the deployed migrations fully represent the schema; a schema edit committed **without** a matching migration makes it exit 2 and fails the job.
2. **Destructive schema guard** — diffs the PR schema against `origin/main`'s schema and runs `schema-destructive-guard.mjs --file` on the result, so a destructive change cannot merge without the `ALLOW_DESTRUCTIVE_SCHEMA` override.

> **Destructive pushes are exceptional.** v3.8.10 executed a single reviewed destructive push (dropping the dead marketplace/stars models, the legacy `UserOrganization.role` enum column, the migrated `User` profile columns, and the `imageModel` columns) — only after every reader/writer had been cut over, a grep proved zero source references, and a **DB snapshot was taken immediately before the push**. Follow that procedure for any future drop; see [Upgrading → v3.8.9 → v3.8.10](../operations-guide/upgrading.md#v3-8-9-v3-8-10).

---

## Repository-only Prisma access

**Only repositories** may call Prisma directly. Repositories live under:

```
libraries/nestjs-libraries/src/database/prisma/[domain]/
```

Each domain has its own repository directory. Repositories extend `PrismaRepository`:

```ts
@Injectable()
export class PostsRepository extends PrismaRepository<'post'> {
  // ...
}
```

`PrismaRepository` is exported from `libraries/nestjs-libraries/src/database/prisma/prisma.service.ts`.

The layering rule is strict:

```
Controller → Service/Manager → Repository → Prisma
```

Controllers and services must **never** import `PrismaClient` or call Prisma methods directly. When one service needs data from another domain, it must call that domain's **service**, not its repository.

See [Backend Conventions](./backend-conventions.md) for the full layering rules and sanctioned exceptions.

### Available repository directories

| Directory | Repository |
|---|---|
| `ai-rag/` | RAG index operations (raw SQL for vector side table) |
| `ai-settings/` | AI provider config, spend logs |
| `analytics/` | Snapshot queries and rollup |
| `announcements/` | System announcements |
| `api-keys/` | Per-user hashed API keys |
| `audit/` | Audit log writes |
| `auth-providers/` | Platform login provider config (`AuthProviderConfig`) |
| `autopost/` | AutoPost CRUD |
| `brands/` | Brand profiles (`AIBrandProfile`, many-per-org) |
| `campaigns/` | Campaign CRUD + post association |
| `emails/` | Email send-log lifecycle |
| `featured-providers/` | Curated featured-provider list |
| `integrations/` | Integration/plug/webhook management |
| `media/` | Media CRUD, folder operations, multipart uploads |
| `media-providers/` | Per-org media provider config (`MediaProviderConfig`) |
| `notifications/` | Notification delivery |
| `oauth/` | OAuth app and authorization management |
| `organizations/` | Organization and user-org relationship |
| `posts/` | Post CRUD, state transitions, recursive queries |
| `provider-configs/` | `OrgProviderConfiguration` and legacy `ProviderConfiguration` |
| `roles/` | RBAC roles and permissions (`AppRole`/`Permission`) |
| `sets/` | Content set management |
| `short-links/` | Per-org short-link provider config |
| `signatures/` | Signature management |
| `social-comments/` | Social comment sync, read-state tracking |
| `storage/` | Storage provider config (S3, R2, B2, etc.) |
| `subscriptions/` | Billing subscriptions |
| `users/` | User CRUD, profiles (`UserProfile`), sessions |
| `watchlist/` | Competitor account and metric tracking |
| `webhooks/` | Webhook CRUD + integration-webhook linking |

---

## Encryption at rest

Secrets stored in the database (OAuth tokens, API keys, credentials) are encrypted with AES-256-GCM via `EncryptionService`. Encrypted values use a `v2:` prefix. The service uses a `ENCRYPTION_KEY` env var or falls back to deriving from `JWT_SECRET`.

**Single-key model.** Encryption uses **one deployment-wide key** — `ENCRYPTION_KEY` if set, otherwise `sha256(JWT_SECRET)` (see `getEncryptionKey()` in `libraries/helpers/src/auth/auth.service.ts`). There is **no per-organization crypto key**. An `organizationId` column scopes where a ciphertext is *stored*, not how it is encrypted; cross-org isolation is enforced by **query scoping**, not cryptography. Every encrypted row in the deployment decrypts with the same key.

`EncryptionService` (used for per-org domain rows) is a thin wrapper over `AuthService.fixedEncryption`/`fixedDecryption` (used for global rows). The split is an **implementation detail** — both paths derive the identical key and produce the identical `v2:` GCM envelope. Use the route that matches how a given row was written; never mix the two for the same row.

Models with encrypted fields:
- `Integration` — `token`, `refreshToken`
- `OrgProviderConfiguration` — `clientId`, `clientSecret`, `additionalConfig`
- `AIOrgProviderConfig` — `credentials`
- `StorageProviderConfig` — `credentials`
- `OrgShortLinkConfig` — `credentials`
- `MediaProviderConfig` — `credentials`
- `AuthProviderConfig` — `clientId`, `clientSecret`
- `OAuthApp` — `clientSecret`
- `OAuthAuthorization` — `accessToken`, `refreshToken`

Refresh tokens for login sessions are **hashed**, not encrypted — `Session.tokenHash` stores `sha256(refreshToken)`; the token itself is never persisted.

---

## PrismaService

`PrismaService` extends `PrismaClient` and implements `OnModuleInit` / `OnModuleDestroy` for lifecycle management. It emits query-level log events for debugging.

`PrismaRepository<T>` is a generic base class that provides typed access to a single Prisma model. `PrismaTransaction` wraps `$transaction` for multi-repository transactional workflows.

---

## Connection-pool tuning

`PrismaService` optionally tunes the Prisma client's connection pool from environment variables. When **either** is set, the corresponding query parameter is appended to `DATABASE_URL` before it is handed to `PrismaClient`; when **both are unset** the datasource URL — and therefore the default pool behaviour — is **byte-for-byte unchanged**.

| Env var | Prisma param | Effect |
|---|---|---|
| `DATABASE_CONNECTION_LIMIT` | `connection_limit` | Max connections this process opens to Postgres |
| `DATABASE_POOL_TIMEOUT` | `pool_timeout` | Seconds a query waits for a free pool connection before erroring |

**Recommended starting values.** Prisma defaults `connection_limit` to `num_physical_cpus * 2 + 1` per process. Size the pool against Postgres's own `max_connections` and **remember the separate Inngest worker shares the same database** — every backend replica *and* the worker each open their own pool, so the aggregate must stay under `max_connections` (leaving headroom for admin/migration connections):

```
total_connections ≈ (backend_replicas + inngest_workers) × DATABASE_CONNECTION_LIMIT
```

A reasonable start for a small/medium deployment: `DATABASE_CONNECTION_LIMIT=10`, `DATABASE_POOL_TIMEOUT=20`. Raise the limit only after confirming Postgres `max_connections` (or the pgBouncer pool) has room across **all** backend replicas plus the Inngest worker. When fronted by pgBouncer in transaction mode, set a low per-process limit and let the bouncer pool.

> Verified against v1.0.0
