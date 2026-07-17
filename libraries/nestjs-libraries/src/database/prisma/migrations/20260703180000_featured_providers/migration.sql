-- CreateTable
CREATE TABLE "FeaturedProvider" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeaturedProvider_domain_sortOrder_idx" ON "FeaturedProvider"("domain", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedProvider_domain_providerId_key" ON "FeaturedProvider"("domain", "providerId");
