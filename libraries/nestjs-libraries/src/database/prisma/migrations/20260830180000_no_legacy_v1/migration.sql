-- Destructive migration: drops the legacy global provider-config tables
-- ("AIProviderConfig", "ProviderConfiguration" — replaced by the per-tenant
-- AIOrgProviderConfig / OrgProviderConfiguration stacks), the legacy global AI
-- selection/rate-limit columns on "AISystemSettings" (per-tenant selection now
-- lives on AIOrgProviderConfig), and the deprecated per-user email-toggle
-- columns on "UserProfile" (superseded by NotificationPreference.categories;
-- the opt-out backfill already ran in prod, ledger key
-- `backfill:notification email prefs`, 2026-07-17).
-- Ops: run `prisma migrate deploy` with ALLOW_DESTRUCTIVE_SCHEMA=true after
-- operator sign-off.

-- Backfill: bind unbound integrations to their org's primary provider config
-- before the by-identifier fallback in IntegrationManager.getClientInformation
-- is gone. "Primary" matches OrgProviderConfigManager's per-identifier pick:
-- enabled-first, then first in (identifier asc, name asc) repository order —
-- id asc added as a deterministic final tiebreak.
UPDATE "Integration" i
SET "providerConfigId" = sub.id
FROM (
  SELECT DISTINCT ON ("organizationId", identifier) id, "organizationId", identifier
  FROM "OrgProviderConfiguration"
  ORDER BY "organizationId", identifier, enabled DESC, "name" ASC, id ASC
) sub
WHERE i."providerConfigId" IS NULL
  AND i."organizationId" = sub."organizationId"
  AND i."providerIdentifier" = sub.identifier;

-- DropIndex
DROP INDEX "AISystemSettings_activeProvider_idx";

-- AlterTable
ALTER TABLE "AISystemSettings" DROP COLUMN "activeProvider",
DROP COLUMN "activeModel",
DROP COLUMN "scopeModels",
DROP COLUMN "rateLimitSettings";

-- AlterTable
ALTER TABLE "UserProfile" DROP COLUMN "sendSuccessEmails",
DROP COLUMN "sendFailureEmails",
DROP COLUMN "sendStreakEmails";

-- DropTable
DROP TABLE "AIProviderConfig";

-- DropTable
DROP TABLE "ProviderConfiguration";

-- DropTable: runtime-only Mastra telemetry tables, created by 0_init but no
-- longer in the Prisma schema (the migration drift check requires the deployed
-- DB to match the datamodel exactly). Empty in prod; Mastra recreates them on
-- demand if a future version writes telemetry.
DROP TABLE "mastra_ai_spans";

-- DropTable
DROP TABLE "mastra_evals";
