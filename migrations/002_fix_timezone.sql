-- 002_fix_timezone.sql
-- 将 created_at 和 updated_at 列改为 TIMESTAMPTZ，确保时区正确

-- audit_logs
ALTER TABLE audit_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ;
UPDATE audit_logs SET created_at = created_at AT TIME ZONE 'Asia/Shanghai';

-- notifications
ALTER TABLE notifications ALTER COLUMN created_at TYPE TIMESTAMPTZ;
UPDATE notifications SET created_at = created_at AT TIME ZONE 'Asia/Shanghai';

-- order_files
ALTER TABLE order_files ALTER COLUMN created_at TYPE TIMESTAMPTZ;
UPDATE order_files SET created_at = created_at AT TIME ZONE 'Asia/Shanghai';
