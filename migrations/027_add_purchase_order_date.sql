-- 采购节点人工设置“下单时间”，与自动带出的开始时间分离
ALTER TABLE process_stages ADD COLUMN IF NOT EXISTS order_date TEXT;
