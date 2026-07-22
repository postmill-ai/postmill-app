-- Add per-provider budget columns to AIOrgProviderConfig
ALTER TABLE "AIOrgProviderConfig" ADD COLUMN "budgetMonthlyCap" DOUBLE PRECISION;
ALTER TABLE "AIOrgProviderConfig" ADD COLUMN "budgetDailyCap" DOUBLE PRECISION;
ALTER TABLE "AIOrgProviderConfig" ADD COLUMN "budgetAlertThresholdPct" DOUBLE PRECISION;
