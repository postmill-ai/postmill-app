ALTER TABLE "Organization" ADD COLUMN "ragEnabled" BOOLEAN;
ALTER TABLE "AIBrandProfile" ADD COLUMN "preferredFormats" JSONB DEFAULT '[]';
ALTER TABLE "AIContentIndex" ADD COLUMN "brandProfileId" TEXT;
ALTER TABLE "DesignTemplate" ADD COLUMN "brandProfileId" TEXT;

CREATE INDEX "AIContentIndex_organizationId_brandProfileId_idx" ON "AIContentIndex"("organizationId", "brandProfileId");
CREATE INDEX "DesignTemplate_brandProfileId_idx" ON "DesignTemplate"("brandProfileId");

ALTER TABLE "AIContentIndex"
  ADD CONSTRAINT "AIContentIndex_brandProfileId_fkey"
  FOREIGN KEY ("brandProfileId") REFERENCES "AIBrandProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesignTemplate"
  ADD CONSTRAINT "DesignTemplate_brandProfileId_fkey"
  FOREIGN KEY ("brandProfileId") REFERENCES "AIBrandProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
