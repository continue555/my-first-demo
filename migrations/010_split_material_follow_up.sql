-- 010_split_material_follow_up.sql
UPDATE process_stages
SET stage_order = stage_order + 4
WHERE stage_order >= 14
  AND NOT EXISTS (
    SELECT 1 FROM process_stages x
    WHERE x.order_id = process_stages.order_id AND x.stage_key = 'frame_follow_up'
  );

INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status, start_date, planned_end_date, actual_end_date, operator_id, operator_name, notes)
SELECT o.id, 'frame_follow_up', '机架采购跟进', 13, 'production', 12, 'purchase_frame', COALESCE(mf.status, 'pending'), mf.start_date, mf.planned_end_date, mf.actual_end_date, mf.operator_id, mf.operator_name, mf.notes
FROM orders o
LEFT JOIN process_stages mf ON mf.order_id = o.id AND mf.stage_key = 'material_follow_up'
WHERE NOT EXISTS (SELECT 1 FROM process_stages x WHERE x.order_id = o.id AND x.stage_key = 'frame_follow_up');

INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status, start_date, planned_end_date, actual_end_date, operator_id, operator_name, notes)
SELECT o.id, 'mold_frame_follow_up', '模架采购跟进', 14, 'production', 12, 'purchase_mold_frame', COALESCE(mf.status, 'pending'), mf.start_date, mf.planned_end_date, mf.actual_end_date, mf.operator_id, mf.operator_name, mf.notes
FROM orders o
LEFT JOIN process_stages mf ON mf.order_id = o.id AND mf.stage_key = 'material_follow_up'
WHERE NOT EXISTS (SELECT 1 FROM process_stages x WHERE x.order_id = o.id AND x.stage_key = 'mold_frame_follow_up');

INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status, start_date, planned_end_date, actual_end_date, operator_id, operator_name, notes)
SELECT o.id, 'electrical_follow_up', '电气采购跟进', 15, 'production', 12, 'purchase_electrical', COALESCE(mf.status, 'pending'), mf.start_date, mf.planned_end_date, mf.actual_end_date, mf.operator_id, mf.operator_name, mf.notes
FROM orders o
LEFT JOIN process_stages mf ON mf.order_id = o.id AND mf.stage_key = 'material_follow_up'
WHERE NOT EXISTS (SELECT 1 FROM process_stages x WHERE x.order_id = o.id AND x.stage_key = 'electrical_follow_up');

INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status, start_date, planned_end_date, actual_end_date, operator_id, operator_name, notes)
SELECT o.id, 'cover_follow_up', '外罩采购跟进', 16, 'production', 12, 'purchase_cover', COALESCE(mf.status, 'pending'), mf.start_date, mf.planned_end_date, mf.actual_end_date, mf.operator_id, mf.operator_name, mf.notes
FROM orders o
LEFT JOIN process_stages mf ON mf.order_id = o.id AND mf.stage_key = 'material_follow_up'
WHERE NOT EXISTS (SELECT 1 FROM process_stages x WHERE x.order_id = o.id AND x.stage_key = 'cover_follow_up');

INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status, start_date, planned_end_date, actual_end_date, operator_id, operator_name, notes)
SELECT o.id, 'mold_design_follow_up', '模具设计与采购跟进', 17, 'production', 12, 'mold_design_purchase', COALESCE(mf.status, 'pending'), mf.start_date, mf.planned_end_date, mf.actual_end_date, mf.operator_id, mf.operator_name, mf.notes
FROM orders o
LEFT JOIN process_stages mf ON mf.order_id = o.id AND mf.stage_key = 'material_follow_up'
WHERE NOT EXISTS (SELECT 1 FROM process_stages x WHERE x.order_id = o.id AND x.stage_key = 'mold_design_follow_up');

UPDATE process_stages
SET depends_on = 'frame_follow_up,mold_frame_follow_up,electrical_follow_up,cover_follow_up,mold_design_follow_up'
WHERE stage_key = 'material_in'
  AND depends_on <> 'frame_follow_up,mold_frame_follow_up,electrical_follow_up,cover_follow_up,mold_design_follow_up';

DELETE FROM process_stages WHERE stage_key = 'material_follow_up';
