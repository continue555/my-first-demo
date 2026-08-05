-- 将流程阶段时间统一为纯日期，清理历史遗留的时分秒
UPDATE process_stages SET
  start_date = LEFT(start_date, 10),
  planned_end_date = LEFT(planned_end_date, 10),
  actual_end_date = LEFT(actual_end_date, 10)
WHERE start_date LIKE '%T%' OR planned_end_date LIKE '%T%' OR actual_end_date LIKE '%T%';
