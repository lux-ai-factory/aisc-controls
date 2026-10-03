-- Ledger phase 7: a checklist counts the revisions of its questions (1 as installed, +1 on each review),
-- so the ledger's controls.checklist.questions_revised names the version it made.
ALTER TABLE "checklist" ADD COLUMN "questions_version" INTEGER NOT NULL DEFAULT 1;
