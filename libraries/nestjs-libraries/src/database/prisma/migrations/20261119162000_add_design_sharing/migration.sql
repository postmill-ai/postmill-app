-- CreateTable
CREATE TABLE "DesignShare" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignShareComment" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignShareComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignShare_designId_key" ON "DesignShare"("designId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignShare_token_key" ON "DesignShare"("token");

-- CreateIndex
CREATE INDEX "DesignShare_organizationId_idx" ON "DesignShare"("organizationId");

-- CreateIndex
CREATE INDEX "DesignShare_expiresAt_idx" ON "DesignShare"("expiresAt");

-- CreateIndex
CREATE INDEX "DesignShareComment_shareId_createdAt_idx" ON "DesignShareComment"("shareId", "createdAt");

-- CreateIndex
CREATE INDEX "DesignShareComment_organizationId_idx" ON "DesignShareComment"("organizationId");

-- AddForeignKey
ALTER TABLE "DesignShare" ADD CONSTRAINT "DesignShare_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignShare" ADD CONSTRAINT "DesignShare_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignShareComment" ADD CONSTRAINT "DesignShareComment_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "DesignShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignShareComment" ADD CONSTRAINT "DesignShareComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

