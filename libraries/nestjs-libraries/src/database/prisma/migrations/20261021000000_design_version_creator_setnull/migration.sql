-- DropForeignKey
ALTER TABLE "DesignVersion" DROP CONSTRAINT "DesignVersion_createdById_fkey";

-- AlterTable: versions survive their creator's account deletion (createdById -> null)
ALTER TABLE "DesignVersion" ALTER COLUMN "createdById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
