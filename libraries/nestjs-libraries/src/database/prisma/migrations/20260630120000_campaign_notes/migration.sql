-- CreateTable
CREATE TABLE "CampaignNote" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "mentions" JSONB,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignNoteReaction" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignNoteReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignNote_campaignId_deletedAt_idx" ON "CampaignNote"("campaignId", "deletedAt");

-- CreateIndex
CREATE INDEX "CampaignNote_organizationId_idx" ON "CampaignNote"("organizationId");

-- CreateIndex
CREATE INDEX "CampaignNote_parentId_idx" ON "CampaignNote"("parentId");

-- CreateIndex
CREATE INDEX "CampaignNoteReaction_noteId_idx" ON "CampaignNoteReaction"("noteId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignNoteReaction_noteId_userId_emoji_key" ON "CampaignNoteReaction"("noteId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "CampaignNote" ADD CONSTRAINT "CampaignNote_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignNote" ADD CONSTRAINT "CampaignNote_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CampaignNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignNoteReaction" ADD CONSTRAINT "CampaignNoteReaction_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "CampaignNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
