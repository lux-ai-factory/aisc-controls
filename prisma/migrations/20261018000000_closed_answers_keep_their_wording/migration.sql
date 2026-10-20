-- A closed submission is frozen: each answer keeps the question as it was answered (its text, article,
-- category and place), and the submission keeps the revision of the checklist's questions it answered, so a
-- later edit of the template never changes what it says. Drafts follow the template and leave them empty
-- until they are closed.
ALTER TABLE "submission_answer"
  ADD COLUMN "question_text" TEXT,
  ADD COLUMN "question_article" TEXT,
  ADD COLUMN "question_category" TEXT,
  ADD COLUMN "question_order" INTEGER;
ALTER TABLE "submission" ADD COLUMN "questions_version" INTEGER;

-- Closed submissions from before this get the questions as they are now: the wording they were answered
-- under is not known any more, and today's is the best guess.
UPDATE "submission_answer" a
   SET "question_text" = q."text", "question_article" = q."article", "question_category" = q."category",
       "question_order" = q."order"
  FROM "checklist_question" q, "submission" s
 WHERE q."id" = a."questionId" AND s."id" = a."submissionId" AND s."status" = 'Closed';
UPDATE "submission" s
   SET "questions_version" = c."questions_version"
  FROM "checklist" c
 WHERE c."id" = s."checklistId" AND s."status" = 'Closed';
