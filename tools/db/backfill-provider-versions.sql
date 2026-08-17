-- One-off backfill: idempotently set version='v1' on all provider config/ledger tables
-- and rewrite bare qualified ids / JSON blobs to include @v1.
-- Run inside the postgres container as the DB owner, e.g.:
--   docker exec postmill-postgres psql -U postmill-local -d postmill-db-local -h localhost -f /tmp/backfill-provider-versions.sql

BEGIN;

-- Scalar version columns: any leftover null/empty rows become 'v1'.
UPDATE "AIProviderConfig"        SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "AIOrgProviderConfig"     SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "MediaProviderConfig"     SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "AIMediaJob"              SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "StorageProviderConfig"   SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "OrgShortLinkConfig"      SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "ShortLink"               SET "providerVersion" = 'v1' WHERE "providerVersion" IS NULL OR "providerVersion" = '';
UPDATE "Integration"             SET "providerVersion" = 'v1' WHERE "providerVersion" IS NULL OR "providerVersion" = '';
UPDATE "OrgProviderConfiguration" SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "ProviderConfiguration"   SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "OrgVpnConfig"            SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "ContentPackConfig"       SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';
UPDATE "AuthProviderConfig"      SET "version" = 'v1' WHERE "version" IS NULL OR "version" = '';

-- Qualified string columns: append @v1 to bare identifiers.
UPDATE "AISystemSettings"
   SET "activeProvider"        = "activeProvider" || '@v1'
 WHERE "activeProvider" IS NOT NULL AND "activeProvider" <> '' AND "activeProvider" NOT LIKE '%@%';

UPDATE "AISystemSettings"
   SET "fallbackProvider"      = "fallbackProvider" || '@v1'
 WHERE "fallbackProvider" IS NOT NULL AND "fallbackProvider" <> '' AND "fallbackProvider" NOT LIKE '%@%';

UPDATE "AISystemSettings"
   SET "fallbackImageProvider" = "fallbackImageProvider" || '@v1'
 WHERE "fallbackImageProvider" IS NOT NULL AND "fallbackImageProvider" <> '' AND "fallbackImageProvider" NOT LIKE '%@%';

UPDATE "Organization"
   SET "activeContentPackIdentifier" = "activeContentPackIdentifier" || '@v1'
 WHERE "activeContentPackIdentifier" IS NOT NULL AND "activeContentPackIdentifier" <> '' AND "activeContentPackIdentifier" NOT LIKE '%@%';

-- JSON scopeModels: ensure each scope entry carries version='v1'.
UPDATE "AISystemSettings"
   SET "scopeModels" = (
     SELECT jsonb_object_agg(
       key,
       CASE
         WHEN jsonb_typeof(value) = 'object' THEN
           CASE
             WHEN value ? 'version' THEN value
             ELSE value || '{"version": "v1"}'::jsonb
           END
         ELSE value
       END
     )
     FROM jsonb_each(COALESCE("scopeModels"::jsonb, '{}'::jsonb))
   )::text
 WHERE "scopeModels" IS NOT NULL AND "scopeModels" <> '';

-- JSON vpnSelection: add vpnVersion='v1' when enabled and identifier is present.
UPDATE "OrgProviderConfiguration"
   SET "vpnSelection" = (
     jsonb_set(
       "vpnSelection"::jsonb,
       '{vpnVersion}',
       '"v1"'::jsonb,
       true
     )
   )::text
 WHERE "vpnSelection" IS NOT NULL AND "vpnSelection" <> ''
   AND ("vpnSelection"::jsonb->>'enabled')::boolean = true
   AND "vpnSelection"::jsonb->>'identifier' IS NOT NULL
   AND "vpnSelection"::jsonb->>'identifier' <> ''
   AND ("vpnSelection"::jsonb->>'vpnVersion') IS NULL;

COMMIT;
