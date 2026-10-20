-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('Draft', 'Closed');

-- CreateTable
CREATE TABLE "source" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "citation" TEXT,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist" (
    "id" TEXT NOT NULL,
    "catalogueId" TEXT,
    "title" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "source_updated_at" TIMESTAMPTZ(3),
    "countryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "regulationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "controlTopic" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_question" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "article" TEXT,
    "category" TEXT,

    CONSTRAINT "checklist_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'Draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_answer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" TEXT,
    "score" INTEGER,

    CONSTRAINT "submission_answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_slug_key" ON "source"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "source_name_key" ON "source"("name");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_catalogueId_key" ON "checklist"("catalogueId");

-- CreateIndex
CREATE INDEX "checklist_sourceId_idx" ON "checklist"("sourceId");

-- CreateIndex
CREATE INDEX "checklist_question_checklistId_idx" ON "checklist_question"("checklistId");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_question_checklistId_order_key" ON "checklist_question"("checklistId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "submission_previousVersionId_key" ON "submission"("previousVersionId");

-- CreateIndex
CREATE INDEX "submission_checklistId_idx" ON "submission"("checklistId");

-- CreateIndex
CREATE INDEX "submission_status_idx" ON "submission"("status");

-- CreateIndex
CREATE INDEX "submission_archived_at_idx" ON "submission"("archived_at");

-- CreateIndex
CREATE INDEX "submission_answer_submissionId_idx" ON "submission_answer"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_answer_submissionId_questionId_key" ON "submission_answer"("submissionId", "questionId");

-- AddForeignKey
ALTER TABLE "checklist" ADD CONSTRAINT "checklist_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_question" ADD CONSTRAINT "checklist_question_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answer" ADD CONSTRAINT "submission_answer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answer" ADD CONSTRAINT "submission_answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "checklist_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

