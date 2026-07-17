-- AnalyticsAlertRule.integrationId was a bare string with no FK (unlike
-- AnalyticsAnomaly.integrationId, which cascades). Add the same cascade so
-- deleting a channel deletes its scoped rules instead of leaving dangling
-- rules that silently never fire.

-- Clean any dangling references first (pre-release table; a dev DB may hold
-- rules pointing at since-deleted integrations, which would violate the FK).
DELETE FROM "AnalyticsAlertRule"
WHERE "integrationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Integration" i WHERE i."id" = "AnalyticsAlertRule"."integrationId"
  );

-- AddForeignKey
ALTER TABLE "AnalyticsAlertRule" ADD CONSTRAINT "AnalyticsAlertRule_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
