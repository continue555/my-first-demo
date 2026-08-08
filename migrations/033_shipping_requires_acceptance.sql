-- 发货需提货款到账且调试验收均已完成
UPDATE process_stages SET depends_on = 'delivery_payment,debug' WHERE stage_key = 'shipping';
