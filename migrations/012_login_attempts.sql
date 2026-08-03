-- 012_login_attempts.sql
CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_time BIGINT NOT NULL,
  locked_until BIGINT
);
