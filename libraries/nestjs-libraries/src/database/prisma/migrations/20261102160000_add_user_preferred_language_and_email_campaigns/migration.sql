ALTER TABLE "UserProfile" ADD COLUMN "preferredLanguage" TEXT;

ALTER TABLE "EmailLog" ADD COLUMN "campaignId" TEXT;

CREATE UNIQUE INDEX "EmailLog_campaignId_toAddress_key" ON "EmailLog"("campaignId", "toAddress");
CREATE INDEX "EmailLog_campaignId_status_idx" ON "EmailLog"("campaignId", "status");
