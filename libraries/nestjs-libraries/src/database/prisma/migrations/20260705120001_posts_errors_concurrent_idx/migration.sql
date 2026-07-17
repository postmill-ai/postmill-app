-- CreateIndex
-- 4.3c: additive index (index-only, migration-safe — no backfill).
-- NOTE (ops): `Errors` can be large in production (one row per publish failure), so this
-- migration uses `CREATE INDEX CONCURRENTLY` to avoid an ACCESS EXCLUSIVE lock. It is kept
-- as a single-statement migration because Prisma wraps multi-statement PostgreSQL migrations
-- in a transaction, and `CONCURRENTLY` cannot run inside a transaction. Schedule during a
-- low-traffic deploy window.
CREATE INDEX CONCURRENTLY "Errors_postId_idx" ON "Errors"("postId");
