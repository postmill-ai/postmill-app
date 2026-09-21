-- Payments as a ProviderKernel domain: bind orgs/subscriptions to the provider
-- that bills them and widen the webhook ledger to every provider. Additive only;
-- existing Stripe rows are backfilled in place.
ALTER TABLE "Organization" ADD COLUMN "paymentProvider" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE "StripeEvent" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'stripe';

UPDATE "Organization"
SET "paymentProvider" = 'stripe'
WHERE "paymentId" IS NOT NULL AND "paymentProvider" IS NULL;
