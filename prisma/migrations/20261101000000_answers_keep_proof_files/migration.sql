-- The files that prove an answer. The platform stores each file (in this project's MinIO bucket) and never
-- deletes it; a row here links one stored file to one answer, with what the platform said the file is.
-- Removing a file from an answer deletes only its row. A new version of a submission starts with a copy of
-- the previous version's rows (the same files, linked again).
CREATE TABLE "submission_answer_file" (
    "id" TEXT NOT NULL,
    "answer_id" TEXT NOT NULL,
    "file_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_answer_file_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "submission_answer_file_answer_id_idx" ON "submission_answer_file"("answer_id");
CREATE UNIQUE INDEX "submission_answer_file_answer_id_file_id_key" ON "submission_answer_file"("answer_id", "file_id");

ALTER TABLE "submission_answer_file" ADD CONSTRAINT "submission_answer_file_answer_id_fkey"
  FOREIGN KEY ("answer_id") REFERENCES "submission_answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The two readers read it as they read the answers (20260926000100_readers_read_the_listed_tables).
DO $$
DECLARE
  reader text;
BEGIN
  FOREACH reader IN ARRAY ARRAY['report_ro', 'dashboard_ro'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = reader) THEN
      EXECUTE format('GRANT SELECT ON controls.submission_answer_file TO %I', reader);
    END IF;
  END LOOP;
END $$;
