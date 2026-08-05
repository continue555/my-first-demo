INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status)
SELECT o.id, 'delivery_payment', '提货款到账', 22, NULL, 3, 'debug', 'pending'
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM process_stages ps WHERE ps.order_id = o.id AND ps.stage_key = 'delivery_payment');

UPDATE process_stages SET stage_order = 23 WHERE stage_key = 'shipping';
