-- CreateIndex
-- §6.2 (MEDIA_REMEDIATION): additive index for the media-job polling sweep, which
-- selects pending/processing jobs across ALL orgs ordered by createdAt (no org filter).
-- The existing ("organizationId","status","createdAt") index cannot serve an org-blind
-- scan, so one flooding org's rows dominated the seq scan. Index-only, migration-safe
-- (no backfill).
-- NOTE (ops): non-CONCURRENT CREATE INDEX (CONCURRENTLY cannot run inside Prisma's
-- transactional migration). Takes a brief ACCESS EXCLUSIVE lock while it builds; the
-- "AIMediaJob" table is small (one row per generation), so the write-stall is negligible.
CREATE INDEX "AIMediaJob_status_createdAt_idx" ON "AIMediaJob"("status", "createdAt");
