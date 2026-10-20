-- A question removed from the template no longer takes a closed submission's answer to it with it: the
-- answer stays, with the wording it keeps (20261018000000), and only its link to the question is cleared.
-- A draft's answers to it are deleted by the review itself, which records them.
ALTER TABLE "submission_answer" ALTER COLUMN "questionId" DROP NOT NULL;
ALTER TABLE "submission_answer" DROP CONSTRAINT "submission_answer_questionId_fkey";
ALTER TABLE "submission_answer" ADD CONSTRAINT "submission_answer_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "checklist_question"("id") ON DELETE SET NULL ON UPDATE CASCADE;
