-- CreateTable
CREATE TABLE "AnalyticsShare" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsShare_organizationId_key" ON "AnalyticsShare"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsShare_token_key" ON "AnalyticsShare"("token");
