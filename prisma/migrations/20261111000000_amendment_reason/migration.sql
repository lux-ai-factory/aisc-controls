-- An amendment (a new version made from a closed submission) records why the answers are corrected and who
-- asked for it, so a report can list the corrections. Empty on a first version and on older amendments.
ALTER TABLE "submission" ADD COLUMN "amend_reason" TEXT;
ALTER TABLE "submission" ADD COLUMN "amend_requested_by" TEXT;
