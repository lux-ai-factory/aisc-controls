-- AlterTable
ALTER TABLE "Questionnaire" ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "citation" TEXT;
