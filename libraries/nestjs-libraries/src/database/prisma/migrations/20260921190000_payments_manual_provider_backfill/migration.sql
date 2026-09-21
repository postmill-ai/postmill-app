-- The payments-domain backfill labelled every org with a paymentId as 'stripe',
-- but admin-granted subscriptions store a user id there and lifetime deals never
-- had a vendor customer. Mark those 'manual' so the orchestrator never calls a
-- vendor with a bogus customer ref. Idempotent; Stripe customer ids are 'cus_…'.
UPDATE "Organization"
SET "paymentProvider" = 'manual'
WHERE "paymentProvider" = 'stripe' AND "paymentId" IS NOT NULL AND "paymentId" NOT LIKE 'cus\_%';

UPDATE "Subscription" s
SET "provider" = 'manual'
FROM "Organization" o
WHERE s."organizationId" = o."id"
  AND s."provider" = 'stripe'
  AND (s."isLifetime" = true OR o."paymentProvider" = 'manual');
