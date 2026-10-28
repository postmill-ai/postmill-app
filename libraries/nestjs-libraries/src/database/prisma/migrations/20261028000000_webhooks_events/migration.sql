-- AlterTable: per-webhook event subscriptions; empty array = receives all events
-- (matches the pre-existing behavior for rows created before this column existed).
ALTER TABLE "Webhooks" ADD COLUMN "events" TEXT[] DEFAULT ARRAY[]::TEXT[];
