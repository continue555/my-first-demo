-- 修复流程定义中引用了不存在的部门（9/10）的问题
-- manufacturing_approval 制造审批 -> 生产部门(2)
-- shipping 发货 -> 销售部门(1)
UPDATE process_stages SET department_id = 2
WHERE stage_key = 'manufacturing_approval' AND department_id = 10;

UPDATE process_stages SET department_id = 1
WHERE stage_key = 'shipping' AND department_id = 9;

-- 修正历史通知中指向不存在部门的记录
UPDATE notifications SET recipient_dept_id = 2 WHERE recipient_dept_id = 10;
UPDATE notifications SET recipient_dept_id = 1 WHERE recipient_dept_id = 9;
