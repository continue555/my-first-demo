-- 006_update_stage_departments.sql
UPDATE process_stages SET department_id = 10
WHERE stage_key = 'manufacturing_approval' AND department_id = 2;

UPDATE process_stages SET department_id = 9
WHERE stage_key = 'shipping' AND department_id = 1;
