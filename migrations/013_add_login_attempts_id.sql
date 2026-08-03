-- 013_add_login_attempts_id.sql
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS id SERIAL;
