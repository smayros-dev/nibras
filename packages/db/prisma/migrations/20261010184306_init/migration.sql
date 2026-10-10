-- Gives SP1's first model migration a predecessor. Idempotent.
CREATE EXTENSION IF NOT EXISTS citext;

-- app_user (the API role, no BYPASSRLS) reads/writes every table app_system creates.
-- Kept here rather than in init.sql so a Prisma reset (which recreates `public`) restores it.
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
