-- I2.6 (isolation 2026-09-25): the two readers, report_ro and dashboard_ro, read exactly the
-- listed tables of this schema, granted here by their owner (controls_rw), and nothing by a
-- default privilege, which would also cover any table made later. This undoes the broad grant
-- of 20260923210100_dashboard_reads_controls (every table, _prisma_migrations included, and a
-- default privilege), which stays as it was because Prisma checks applied migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE controls_rw IN SCHEMA controls REVOKE SELECT ON TABLES FROM dashboard_ro;
REVOKE SELECT ON controls."_prisma_migrations" FROM dashboard_ro;

-- A reader that does not exist in this cluster is skipped.
DO $$
DECLARE
  reader text;
BEGIN
  FOREACH reader IN ARRAY ARRAY['report_ro', 'dashboard_ro'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = reader) THEN
      EXECUTE format(
        'GRANT SELECT ON controls.checklist, controls.checklist_question, controls.source, '
        'controls.submission, controls.submission_answer TO %I', reader);
    END IF;
  END LOOP;
END $$;
