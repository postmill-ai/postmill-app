-- AlterTable: org-wide AI budget ceiling (additive, nullable)
ALTER TABLE "Organization" ADD COLUMN "aiBudgetMonthlyCap" DOUBLE PRECISION;
ALTER TABLE "Organization" ADD COLUMN "aiBudgetDailyCap" DOUBLE PRECISION;
ALTER TABLE "Organization" ADD COLUMN "aiBudgetAlertThresholdPct" DOUBLE PRECISION;
