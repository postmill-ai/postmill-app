-- CreateTable
CREATE TABLE "OrgDefaultModel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "model" TEXT,
    "settings" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgDefaultModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgDefaultModel_organizationId_domain_idx" ON "OrgDefaultModel"("organizationId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "OrgDefaultModel_organizationId_domain_category_key" ON "OrgDefaultModel"("organizationId", "domain", "category");

-- AddForeignKey
ALTER TABLE "OrgDefaultModel" ADD CONSTRAINT "OrgDefaultModel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

