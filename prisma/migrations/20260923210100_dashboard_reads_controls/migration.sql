-- The dashboard reads this project's answers, and only reads them. controls_rw owns the
-- tables, so the grant is made here; CONNECT and USAGE come from the platform's project
-- template.
GRANT SELECT ON ALL TABLES IN SCHEMA controls TO dashboard_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE controls_rw IN SCHEMA controls GRANT SELECT ON TABLES TO dashboard_ro;
