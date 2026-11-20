-- AlterTable
ALTER TABLE "Design" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "DesignBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceDesignId" TEXT,
    "sourceTemplateId" TEXT,
    "sourceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignBatch_jobId_key" ON "DesignBatch"("jobId");

-- CreateIndex
CREATE INDEX "DesignBatch_organizationId_updatedAt_idx" ON "DesignBatch"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Design_batchId_idx" ON "Design"("batchId");

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DesignBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignBatch" ADD CONSTRAINT "DesignBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignBatch" ADD CONSTRAINT "DesignBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
