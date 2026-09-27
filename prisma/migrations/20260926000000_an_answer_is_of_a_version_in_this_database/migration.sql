-- I6.2 (isolation 2026-09-25): an answer's card version is a row of this project's own
-- project.system, made by the platform template 0006. NO ACTION: versions are never deleted,
-- and an answer must never be lost by a delete. The data move fills project.system before
-- this runs (cutover order); if it has not, this refuses and names the version.
--
-- The check comes first, so the key is never added when it refuses. A refused run leaves a
-- failed row in _prisma_migrations: once the data is fixed, run
-- `prisma migrate resolve --rolled-back 20260926000000_an_answer_is_of_a_version_in_this_database`
-- before deploying again.
DO $$
DECLARE
  absent uuid;
  n bigint;
BEGIN
  IF to_regclass('project.system') IS NULL THEN
    RAISE EXCEPTION 'project.system is missing in database %: apply the platform template 0006_project_system.sql first', current_database();
  END IF;
  SELECT a.system_version_pid, count(*) OVER () INTO absent, n
    FROM "submission_answer" a
   WHERE a.system_version_pid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM project.system s WHERE s.pid = a.system_version_pid)
   ORDER BY a.system_version_pid LIMIT 1;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'an answer names card version % which is not in project.system (% answers do); run the data move (platform_service.isolate copy) before this migration', absent, n;
  END IF;
END $$;

ALTER TABLE "submission_answer"
  ADD CONSTRAINT "submission_answer_system_version_pid_fkey"
  FOREIGN KEY ("system_version_pid") REFERENCES "project"."system"("pid")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
