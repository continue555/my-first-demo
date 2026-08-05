-- 清理 order_files 中指向已删除用户的上传人
UPDATE order_files SET uploaded_by = NULL
WHERE uploaded_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = order_files.uploaded_by);
