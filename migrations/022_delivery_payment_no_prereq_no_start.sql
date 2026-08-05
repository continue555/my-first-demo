-- 提货款到账：无前置条件、无开始时间
UPDATE process_stages SET depends_on = NULL, start_date = NULL WHERE stage_key = 'delivery_payment';
