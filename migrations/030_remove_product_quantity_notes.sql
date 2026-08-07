-- 用户要求彻底移除产品型号/数量/订单备注字段，订单不再存储；节点备注保留
ALTER TABLE orders DROP COLUMN IF EXISTS product_model;
ALTER TABLE orders DROP COLUMN IF EXISTS quantity;
ALTER TABLE orders DROP COLUMN IF EXISTS notes;
