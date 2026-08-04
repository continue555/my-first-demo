ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_role TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(recipient_role) WHERE recipient_role IS NOT NULL;
