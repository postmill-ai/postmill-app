-- Rename SubscriptionTier enum values to the Postmill plan set.
ALTER TYPE "SubscriptionTier" RENAME VALUE 'STANDARD' TO 'STARTER';
ALTER TYPE "SubscriptionTier" RENAME VALUE 'ULTIMATE' TO 'AGENCY';

-- Add-on and deferred-downgrade columns (additive, defaulted, non-destructive).
ALTER TABLE "Subscription" ADD COLUMN "extraStorageGb" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "extraVideoExports" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "pendingTier" "SubscriptionTier";
