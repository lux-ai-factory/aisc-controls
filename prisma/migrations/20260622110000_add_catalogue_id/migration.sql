-- AlterTable
ALTER TABLE "Checklist" ADD COLUMN     "catalogueId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_catalogueId_key" ON "Checklist"("catalogueId");

