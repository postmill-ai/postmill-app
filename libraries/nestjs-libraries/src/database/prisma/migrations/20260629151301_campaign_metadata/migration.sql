-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "client" TEXT,
ADD COLUMN     "project" TEXT,
ADD COLUMN     "tags" JSONB;
