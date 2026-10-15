-- AlterTable
ALTER TABLE "DesignTemplate" ADD COLUMN     "folderId" TEXT;

-- CreateTable
CREATE TABLE "DesignTemplateFolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignTemplateFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignTemplateFolder_organizationId_idx" ON "DesignTemplateFolder"("organizationId");

-- CreateIndex
CREATE INDEX "DesignTemplateFolder_parentId_idx" ON "DesignTemplateFolder"("parentId");

-- CreateIndex
CREATE INDEX "DesignTemplate_folderId_idx" ON "DesignTemplate"("folderId");

-- AddForeignKey
ALTER TABLE "DesignTemplate" ADD CONSTRAINT "DesignTemplate_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DesignTemplateFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignTemplateFolder" ADD CONSTRAINT "DesignTemplateFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DesignTemplateFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignTemplateFolder" ADD CONSTRAINT "DesignTemplateFolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
