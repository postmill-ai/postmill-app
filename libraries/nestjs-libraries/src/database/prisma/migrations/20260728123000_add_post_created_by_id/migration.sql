-- AlterTable — nullable, expand-only: who created the post (null for
-- system/agent/API-key/autopost creations; surfaces creationMethod instead).
ALTER TABLE "Post" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "Post_createdById_idx" ON "Post"("createdById");
