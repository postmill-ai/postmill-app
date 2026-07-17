-- Destructive migration: drops the legacy "ExisingPlugData" table.
-- Ops: confirm this table is empty in all environments before deploying.
-- If it contains data, export/backfill first. Run `prisma migrate deploy` with
-- ALLOW_DESTRUCTIVE_SCHEMA=true after operator sign-off.

-- DropForeignKey
ALTER TABLE "ExisingPlugData" DROP CONSTRAINT "ExisingPlugData_integrationId_fkey";

-- DropTable
DROP TABLE "ExisingPlugData";
