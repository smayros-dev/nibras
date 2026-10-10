-- Idempotent with infra/docker/postgres/init.sql; gives SP1's first model migration a predecessor.
CREATE EXTENSION IF NOT EXISTS citext;
