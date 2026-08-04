-- 移除已废弃的订单状态 delayed：历史数据归一化为进行中
UPDATE orders SET status = 'in_progress' WHERE status = 'delayed';
