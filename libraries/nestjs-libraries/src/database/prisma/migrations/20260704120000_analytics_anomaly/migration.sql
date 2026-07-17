-- CreateTable
CREATE TABLE "AnalyticsAnomaly" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "deviation" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "topPostId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsAnomaly_organizationId_createdAt_idx" ON "AnalyticsAnomaly"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsAnomaly_integrationId_metric_date_key" ON "AnalyticsAnomaly"("integrationId", "metric", "date");

-- AddForeignKey
ALTER TABLE "AnalyticsAnomaly" ADD CONSTRAINT "AnalyticsAnomaly_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
