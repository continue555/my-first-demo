-- 008_add_mold_stage.sql
INSERT INTO departments (id, name, parent_id, description)
SELECT 11, '模具部', 2, '负责模具设计与采购'
WHERE EXISTS (SELECT 1 FROM departments WHERE id = 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (username, password, name, department_id, role)
SELECT 'muji1', '$2a$10$CaWMq26QL4loY8mrjY5ZLeFwu.iT5zf3YR2HlviEK1qMX9gTo2nlq', '模具管理', 11, 'mold'
WHERE EXISTS (SELECT 1 FROM departments WHERE id = 11)
ON CONFLICT (username) DO NOTHING;

UPDATE process_stages
SET stage_order = stage_order + 1
WHERE stage_order >= 12
  AND NOT EXISTS (
    SELECT 1 FROM process_stages x
    WHERE x.order_id = process_stages.order_id AND x.stage_key = 'mold_design_purchase'
  );

INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status)
SELECT o.id, 'mold_design_purchase', '模具设计与采购', 12, 'production', 11, 'purchase_plan', 'pending'
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM process_stages ps
  WHERE ps.order_id = o.id AND ps.stage_key = 'mold_design_purchase'
);

UPDATE process_stages
SET depends_on = 'purchase_frame,purchase_mold_frame,purchase_electrical,purchase_cover,mold_design_purchase'
WHERE stage_key = 'material_in'
  AND depends_on NOT LIKE '%mold_design_purchase%';
