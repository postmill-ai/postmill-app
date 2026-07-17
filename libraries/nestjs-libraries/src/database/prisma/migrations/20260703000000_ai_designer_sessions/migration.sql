-- CreateTable
CREATE TABLE "AiDesignerSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'image',
    "config" JSONB NOT NULL,
    "brief" JSONB,
    "state" TEXT NOT NULL DEFAULT 'intake',
    "activeDesignIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDesignerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDesignerMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "agent" TEXT,
    "kind" TEXT NOT NULL,
    "replyTo" TEXT,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDesignerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDesignerSession_organizationId_userId_idx" ON "AiDesignerSession"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "AiDesignerSession_userId_idx" ON "AiDesignerSession"("userId");

-- CreateIndex
CREATE INDEX "AiDesignerSession_updatedAt_idx" ON "AiDesignerSession"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiDesignerMessage_sessionId_seq_key" ON "AiDesignerMessage"("sessionId", "seq");

-- AddForeignKey
ALTER TABLE "AiDesignerSession" ADD CONSTRAINT "AiDesignerSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDesignerSession" ADD CONSTRAINT "AiDesignerSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDesignerMessage" ADD CONSTRAINT "AiDesignerMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiDesignerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

