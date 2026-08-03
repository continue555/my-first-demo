-- 009_add_material_follow_up.sql
INSERT INTO departments (id, name, parent_id, description)
VALUES (12, '物料跟进部', 2, '负责跟进五大件采购到货情况')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (username, password, name, department_id, role)
VALUES ('wuliao1', '$2a$10$CaWMq26QL4loY8mrjY5ZLeFwu.iT5zf3YR2HlviEK1qMX9gTo2nlq', '物料跟进', 12, 'material_follow')
ON CONFLICT (username) DO NOTHING;

UPDATE process_stages
SET stage_order = stage_order + 1
WHERE stage_order >= 13
  AND NOT EXISTS (
    SELECT 1 FROM process_stages x
    WHERE x.order_id = process_stages.order_id AND x.stage_key = 'material_follow_up'
  );

INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status)
SELECT o.id, 'material_follow_up', '物料跟进', 13, 'production', 12, 'purchase_frame,purchase_mold_frame,purchase_electrical,purchase_cover,mold_design_purchase', 'pending'
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM process_stages ps
  WHERE ps.order_id = o.id AND ps.stage_key = 'material_follow_up'
);

UPDATE process_stages
SET depends_on = 'material_follow_up'
WHERE stage_key = 'material_in'
  AND depends_on <> 'material_follow_up';
