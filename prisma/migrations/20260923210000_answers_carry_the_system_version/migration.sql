-- Each answer carries the AI card version that was the latest when it was answered
-- (a core.system pid and its number, copied: a project database has no core), and when.
-- Nullable: answers from before this migration, or saved while the platform did not
-- answer, are unstamped.
ALTER TABLE "submission_answer"
  ADD COLUMN "system_version_pid" UUID,
  ADD COLUMN "system_version_number" INTEGER,
  ADD COLUMN "answered_at" TIMESTAMPTZ(3);
