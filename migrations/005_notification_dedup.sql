-- 005_notification_dedup.sql
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source_key
  ON notifications (source_key)
  WHERE source_key IS NOT NULL;
