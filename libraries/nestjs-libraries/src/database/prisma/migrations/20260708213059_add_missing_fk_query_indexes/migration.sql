-- CreateIndex
CREATE INDEX "AIMediaJob_folderId_idx" ON "AIMediaJob"("folderId");

-- CreateIndex
CREATE INDEX "AnalyticsAnomaly_ruleId_idx" ON "AnalyticsAnomaly"("ruleId");

-- CreateIndex
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");

-- CreateIndex
CREATE INDEX "CampaignNote_createdById_idx" ON "CampaignNote"("createdById");

-- CreateIndex
CREATE INDEX "CampaignNote_resolvedById_idx" ON "CampaignNote"("resolvedById");

-- CreateIndex
CREATE INDEX "FileFolder_storageProviderId_idx" ON "FileFolder"("storageProviderId");

-- CreateIndex
CREATE INDEX "MediaProviderConfig_storageProviderId_idx" ON "MediaProviderConfig"("storageProviderId");

-- CreateIndex
CREATE INDEX "MediaProviderConfig_storageRootFolderId_idx" ON "MediaProviderConfig"("storageRootFolderId");

-- CreateIndex
CREATE INDEX "Post_releaseId_idx" ON "Post"("releaseId");

-- CreateIndex
CREATE INDEX "Post_approvedById_idx" ON "Post"("approvedById");

-- CreateIndex
CREATE INDEX "Post_brandId_idx" ON "Post"("brandId");

-- CreateIndex
CREATE INDEX "SocialComment_authorId_idx" ON "SocialComment"("authorId");

-- CreateIndex
CREATE INDEX "StorageProviderConfig_defaultFolderId_idx" ON "StorageProviderConfig"("defaultFolderId");
