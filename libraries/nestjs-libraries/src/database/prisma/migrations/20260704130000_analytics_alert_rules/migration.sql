-- AlterTable
ALTER TABLE "AnalyticsAnomaly" ADD COLUMN "ruleId" TEXT;

-- CreateTable
CREATE TABLE "AnalyticsAlertRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT,
    "metric" TEXT NOT NULL,
    "comparator" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'up',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsAlertRule_organizationId_enabled_idx" ON "AnalyticsAlertRule"("organizationId", "enabled");
