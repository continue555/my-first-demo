-- 用户要求彻底移除客户/项目字段，订单不再存储
ALTER TABLE orders DROP COLUMN IF EXISTS customer_name;
ALTER TABLE orders DROP COLUMN IF EXISTS project_name;
