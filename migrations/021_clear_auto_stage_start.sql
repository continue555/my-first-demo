-- 采购跟进/物料进仓无开始时间概念，清掉历史遗留的开始时间
UPDATE process_stages SET start_date = NULL
WHERE stage_key IN ('frame_follow_up', 'mold_frame_follow_up', 'electrical_follow_up', 'cover_follow_up', 'mold_design_follow_up', 'material_in');
