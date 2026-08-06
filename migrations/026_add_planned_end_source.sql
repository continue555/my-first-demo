-- 标记计划完成日期来源：auto=倒排建议/自动联动，manual=人工设置
ALTER TABLE process_stages ADD COLUMN IF NOT EXISTS planned_end_source TEXT DEFAULT 'auto';
