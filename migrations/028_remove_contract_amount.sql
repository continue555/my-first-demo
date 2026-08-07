-- 用户要求彻底移除金额相关内容，订单不再存储合同金额
ALTER TABLE orders DROP COLUMN IF EXISTS contract_amount;
