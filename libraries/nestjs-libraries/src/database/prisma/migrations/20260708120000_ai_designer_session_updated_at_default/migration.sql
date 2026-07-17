-- Add a database default for AiDesignerSession.updatedAt so raw SQL/ETL inserts
-- do not fail when the Prisma client is not setting @updatedAt.
ALTER TABLE "AiDesignerSession" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
