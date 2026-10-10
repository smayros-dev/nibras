-- Runs once, on first start of an empty Postgres volume (docker-entrypoint-initdb.d).
-- app_system: owner of all tables, runs migrations/worker/test resets (BYPASSRLS, CREATEDB for Prisma's shadow DB).
-- app_user: the API's role, subject to RLS.
CREATE ROLE app_system LOGIN PASSWORD 'app' BYPASSRLS CREATEDB;
CREATE ROLE app_user LOGIN PASSWORD 'app' NOBYPASSRLS;

CREATE DATABASE tt OWNER app_system;
\c tt
CREATE EXTENSION IF NOT EXISTS citext;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

CREATE DATABASE tt_test OWNER app_system;
\c tt_test
CREATE EXTENSION IF NOT EXISTS citext;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
