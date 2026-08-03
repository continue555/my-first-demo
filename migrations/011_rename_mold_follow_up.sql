-- 011_rename_mold_follow_up.sql
UPDATE process_stages
SET stage_name = '模具采购跟进'
WHERE stage_key = 'mold_design_follow_up'
  AND stage_name = '模具设计与采购跟进';
