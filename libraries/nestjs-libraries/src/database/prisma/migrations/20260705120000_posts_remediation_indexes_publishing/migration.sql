-- AlterEnum
-- 0.7: additive enum value for the atomic publish state-claim (QUEUE -> PUBLISHING).
ALTER TYPE "State" ADD VALUE 'PUBLISHING';

-- CreateIndex
CREATE INDEX "AutoPost_organizationId_idx" ON "AutoPost"("organizationId");
