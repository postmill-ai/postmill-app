-- CreateTable
CREATE TABLE "DesignerRecentOpen" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "designId" TEXT,
    "templateId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignerRecentOpen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignerRecentOpen_organizationId_userId_designId_key" ON "DesignerRecentOpen"("organizationId", "userId", "designId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignerRecentOpen_organizationId_userId_templateId_key" ON "DesignerRecentOpen"("organizationId", "userId", "templateId");

-- CreateIndex
CREATE INDEX "DesignerRecentOpen_organizationId_userId_openedAt_idx" ON "DesignerRecentOpen"("organizationId", "userId", "openedAt");

-- CreateIndex
CREATE INDEX "DesignerRecentOpen_designId_idx" ON "DesignerRecentOpen"("designId");

-- CreateIndex
CREATE INDEX "DesignerRecentOpen_templateId_idx" ON "DesignerRecentOpen"("templateId");

-- AddForeignKey
ALTER TABLE "DesignerRecentOpen" ADD CONSTRAINT "DesignerRecentOpen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerRecentOpen" ADD CONSTRAINT "DesignerRecentOpen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerRecentOpen" ADD CONSTRAINT "DesignerRecentOpen_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignerRecentOpen" ADD CONSTRAINT "DesignerRecentOpen_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DesignTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
