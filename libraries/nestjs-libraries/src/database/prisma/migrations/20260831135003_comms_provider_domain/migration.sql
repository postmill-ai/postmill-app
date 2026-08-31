-- CreateTable
CREATE TABLE "CommsProviderConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "credentials" TEXT,
    "extraConfig" JSONB,
    "webhookToken" TEXT NOT NULL,
    "syncCursor" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommsProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommsUserLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connectCode" TEXT,
    "connectCodeExpiresAt" TIMESTAMP(3),
    "externalUserId" TEXT,
    "externalDisplayName" TEXT,
    "externalChannelId" TEXT,
    "agentChatEnabled" BOOLEAN NOT NULL DEFAULT true,
    "categories" JSONB NOT NULL,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommsUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommsProviderConfig_webhookToken_key" ON "CommsProviderConfig"("webhookToken");

-- CreateIndex
CREATE INDEX "CommsProviderConfig_organizationId_idx" ON "CommsProviderConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CommsProviderConfig_organizationId_identifier_version_key" ON "CommsProviderConfig"("organizationId", "identifier", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CommsUserLink_connectCode_key" ON "CommsUserLink"("connectCode");

-- CreateIndex
CREATE INDEX "CommsUserLink_configId_externalUserId_idx" ON "CommsUserLink"("configId", "externalUserId");

-- CreateIndex
CREATE INDEX "CommsUserLink_organizationId_userId_idx" ON "CommsUserLink"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommsUserLink_configId_userId_key" ON "CommsUserLink"("configId", "userId");

-- AddForeignKey
ALTER TABLE "CommsProviderConfig" ADD CONSTRAINT "CommsProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsUserLink" ADD CONSTRAINT "CommsUserLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsUserLink" ADD CONSTRAINT "CommsUserLink_configId_fkey" FOREIGN KEY ("configId") REFERENCES "CommsProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommsUserLink" ADD CONSTRAINT "CommsUserLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

