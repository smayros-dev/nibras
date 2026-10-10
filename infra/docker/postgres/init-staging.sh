#!/bin/sh
# Staging counterpart of init.sql: same roles, real passwords from the environment
# (APP_SYSTEM_DB_PASSWORD, APP_USER_DB_PASSWORD, set in .env.staging). Runs once, on an empty volume.
# Grants for app_user live in the init Prisma migration (applied by the `migrate` service).
set -eu
psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres \
  -v sys_pw="$APP_SYSTEM_DB_PASSWORD" -v user_pw="$APP_USER_DB_PASSWORD" <<'SQL'
CREATE ROLE app_system LOGIN PASSWORD :'sys_pw' BYPASSRLS CREATEDB;
CREATE ROLE app_user LOGIN PASSWORD :'user_pw' NOBYPASSRLS;
CREATE DATABASE tt OWNER app_system;
SQL
