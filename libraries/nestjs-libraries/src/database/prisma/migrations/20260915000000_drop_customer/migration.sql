-- Remove the Postiz-era "Customer" feature (per-client grouping of channels).
-- Postmill scopes channels by organization; nothing else references Customer.
-- Destructive: any remaining grouping is dropped; channels themselves are untouched.

-- DropForeignKey
ALTER TABLE "Integration" DROP CONSTRAINT IF EXISTS "Integration_customerId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Integration_customerId_idx";

-- AlterTable
ALTER TABLE "Integration" DROP COLUMN IF EXISTS "customerId";

-- DropTable
DROP TABLE IF EXISTS "Customer";
