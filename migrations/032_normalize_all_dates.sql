-- 所有阶段与订单时间统一为纯日期
UPDATE process_stages SET
  start_date = LEFT(start_date, 10),
  planned_end_date = LEFT(planned_end_date, 10),
  actual_end_date = LEFT(actual_end_date, 10)
WHERE start_date IS NOT NULL OR planned_end_date IS NOT NULL OR actual_end_date IS NOT NULL;
UPDATE orders SET
  planned_delivery_date = LEFT(planned_delivery_date, 10),
  actual_delivery_date = LEFT(actual_delivery_date, 10)
WHERE planned_delivery_date IS NOT NULL OR actual_delivery_date IS NOT NULL;
