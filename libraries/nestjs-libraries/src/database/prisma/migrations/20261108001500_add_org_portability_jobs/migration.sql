CREATE TABLE "OrgPortabilityJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "progress" JSONB,
  "spoolPath" TEXT,
  "archiveSha256" TEXT,
  "archiveKeyCiphertext" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrgPortabilityJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrgPortabilityJob_organizationId_archiveSha256_key" ON "OrgPortabilityJob"("organizationId", "archiveSha256");
CREATE INDEX "OrgPortabilityJob_organizationId_createdAt_idx" ON "OrgPortabilityJob"("organizationId", "createdAt");
CREATE INDEX "OrgPortabilityJob_ownerId_createdAt_idx" ON "OrgPortabilityJob"("ownerId", "createdAt");
CREATE INDEX "OrgPortabilityJob_status_expiresAt_idx" ON "OrgPortabilityJob"("status", "expiresAt");

ALTER TABLE "OrgPortabilityJob" ADD CONSTRAINT "OrgPortabilityJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgPortabilityJob" ADD CONSTRAINT "OrgPortabilityJob_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
