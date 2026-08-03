-- 007_remove_material_check.sql
DELETE FROM process_stages WHERE stage_key = 'material_check';

UPDATE process_stages
SET depends_on = 'purchase_plan'
WHERE stage_key IN ('purchase_frame', 'purchase_mold_frame', 'purchase_electrical', 'purchase_cover')
  AND depends_on = 'material_check';

UPDATE process_stages
SET stage_order = stage_order - 1
WHERE stage_order >= 9;
