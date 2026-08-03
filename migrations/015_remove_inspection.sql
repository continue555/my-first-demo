-- 015_remove_inspection.sql
UPDATE process_stages SET stage_name = '调试验货' WHERE stage_key = 'debug';

UPDATE process_stages
SET depends_on = 'debug'
WHERE stage_key = 'shipping' AND depends_on = 'inspection';

UPDATE process_stages
SET stage_order = 22
WHERE stage_key = 'shipping' AND stage_order = 23;

DELETE FROM process_stages WHERE stage_key = 'inspection';
