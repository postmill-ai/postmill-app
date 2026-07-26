-- AlterTable: add-on extras for every capped dimension + super-admin limit overrides
ALTER TABLE "Subscription"
ADD COLUMN "extraChannels" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "extraTeamMembers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "extraPosts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "extraBrandKits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "extraWebhooks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "extraCompetitors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "limitOverrides" JSONB;
