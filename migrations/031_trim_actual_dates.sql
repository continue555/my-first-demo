-- 实际完成/实际到货/实际交货日期统一为纯日期
UPDATE process_stages SET actual_end_date = LEFT(actual_end_date, 10)
WHERE actual_end_date IS NOT NULL AND actual_end_date <> LEFT(actual_end_date, 10);
UPDATE orders SET actual_delivery_date = LEFT(actual_delivery_date, 10)
WHERE actual_delivery_date IS NOT NULL AND actual_delivery_date <> LEFT(actual_delivery_date, 10);
