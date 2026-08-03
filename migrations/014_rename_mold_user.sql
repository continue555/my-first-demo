-- 014_rename_mold_user.sql
DELETE FROM users WHERE username = 'muji1';

INSERT INTO users (username, password, name, department_id, role)
SELECT 'mujv1', '$2a$10$CaWMq26QL4loY8mrjY5ZLeFwu.iT5zf3YR2HlviEK1qMX9gTo2nlq', '胡彩静', 11, 'mold'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'mujv1');
