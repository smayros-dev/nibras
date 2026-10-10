-- Runs once, on first start of an empty Postgres volume (docker-entrypoint-initdb.d).
-- app_system: owner of all tables, runs migrations/worker/test resets (BYPASSRLS, CREATEDB for Prisma's shadow DB).
-- app_user: the API's role, subject to RLS.
-- Extensions and app_user's grants live in the init Prisma migration, so they survive a Prisma reset.
CREATE ROLE app_system LOGIN PASSWORD 'app' BYPASSRLS CREATEDB;
CREATE ROLE app_user LOGIN PASSWORD 'app' NOBYPASSRLS;

CREATE DATABASE tt OWNER app_system;
CREATE DATABASE tt_test OWNER app_system;
-- Dedicated shadow DB for `migrate:check`: Prisma wipes the shadow DB on every run.
CREATE DATABASE tt_shadow OWNER app_system;
