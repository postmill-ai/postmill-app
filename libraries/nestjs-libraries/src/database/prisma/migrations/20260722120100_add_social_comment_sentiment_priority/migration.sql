-- Add sentiment/priority/classification-confidence columns to SocialComment
ALTER TABLE "SocialComment" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "SocialComment" ADD COLUMN "priority" TEXT;
ALTER TABLE "SocialComment" ADD COLUMN "sentimentConfidence" DOUBLE PRECISION;

-- Indexes for filtering comments by sentiment/priority within an org
CREATE INDEX "SocialComment_organizationId_sentiment_idx" ON "SocialComment"("organizationId", "sentiment");
CREATE INDEX "SocialComment_organizationId_priority_idx" ON "SocialComment"("organizationId", "priority");
