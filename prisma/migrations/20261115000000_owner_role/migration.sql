-- The controls schema's tables belong to controls_owner, a role no application logs in as.
--
-- Migrations run as controls_migrator (PROJECT_MIGRATE_DATABASE_URL), whose sessions act as
-- controls_owner; the web app connects as controls_rw, which from here on reads and writes rows only:
-- it cannot create, alter, truncate or put triggers on these tables. An answer's reference to the card
-- version it was given under restricts: the version cannot be deleted from under the answer.
--
-- In a project database this stops first unless the schema is controls_owner's and the session acts as
-- controls_owner: the platform hands the schema over (template 0033) once postgres-setup has made the
-- role. Safe on an install whose tables controls_rw made: they are handed to the owner here.

DO $owner$
BEGIN
  IF current_database() ~ '^project_[0-9a-f]{32}$' AND (
       NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'controls_owner')
       OR (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'controls')
          IS DISTINCT FROM 'controls_owner'
       OR current_user <> 'controls_owner') THEN
    RAISE EXCEPTION 'controls_owner is missing or does not own schema controls: run postgres-setup and the platform first, then migrate as controls_migrator (PROJECT_MIGRATE_DATABASE_URL)';
  END IF;
END
$owner$;

ALTER TABLE "submission_answer" DROP CONSTRAINT IF EXISTS "submission_answer_system_version_pid_fkey";
ALTER TABLE "submission_answer"
  ADD CONSTRAINT "submission_answer_system_version_pid_fkey"
  FOREIGN KEY ("system_version_pid") REFERENCES "project"."system"("pid")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'controls_owner')
     OR current_user <> 'controls_owner' THEN
    RETURN;                                      -- a scratch database outside the stack: nothing to hand over
  END IF;
  -- what the runtime role made before it stopped migrating
  REASSIGN OWNED BY controls_rw TO controls_owner;
  REVOKE CREATE ON SCHEMA controls FROM controls_rw;
  GRANT USAGE ON SCHEMA controls TO controls_rw;

  REVOKE ALL ON ALL TABLES IN SCHEMA controls FROM controls_rw;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA controls TO controls_rw;
  -- the migrations' own record is the migrator's
  REVOKE ALL ON controls."_prisma_migrations" FROM controls_rw;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA controls FROM controls_rw;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA controls TO controls_rw;
  ALTER DEFAULT PRIVILEGES FOR ROLE controls_owner IN SCHEMA controls
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO controls_rw;
  ALTER DEFAULT PRIVILEGES FOR ROLE controls_owner IN SCHEMA controls
    GRANT USAGE, SELECT ON SEQUENCES TO controls_rw;
END
$roles$;
