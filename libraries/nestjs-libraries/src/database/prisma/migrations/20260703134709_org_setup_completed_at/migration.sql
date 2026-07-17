-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "setupCompletedAt" TIMESTAMP(3);

-- Backfill existing organizations as already set up
UPDATE "Organization" SET "setupCompletedAt" = now() WHERE "setupCompletedAt" IS NULL;
