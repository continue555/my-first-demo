const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { buildDepartmentFilter } = require('../lib/dept-filter');

const router = express.Router();

// 获取通知列表
router.get('/', authMiddleware, async (req, res) => {
  const db = getDb();
  const { unread, limit } = req.query;
  const userId = req.user.id;

  let where = 'WHERE 1=1';
  const params = [];

  if (unread === 'true') {
    where += ' AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = ?)';
    params.push(userId);
  }

  const deptFilter = await buildDepartmentFilter(req.user, 'n');
  where += deptFilter.sql;
  params.push(...deptFilter.params);

  const notifications = await db.prepare(`
    SELECT n.*, o.order_no,
      CASE WHEN EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = ?) THEN 1 ELSE 0 END AS is_read
    FROM notifications n
    LEFT JOIN orders o ON n.order_id = o.id
    ${where}
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(userId, ...params, parseInt(limit) || 50);

  let unreadWhere = 'WHERE NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = ?)';
  const unreadParams = [userId];
  const unreadDeptFilter = await buildDepartmentFilter(req.user, 'n');
  unreadWhere += unreadDeptFilter.sql;
  unreadParams.push(...unreadDeptFilter.params);

  const unreadCount = await db.prepare(`SELECT COUNT(*) as cnt FROM notifications n ${unreadWhere}`).get(...unreadParams);
  res.json({ notifications, unreadCount: unreadCount.cnt });
});

// 标记已读（仅当前用户）
router.put('/:id/read', authMiddleware, async (req, res) => {
  const db = getDb();
  await db.prepare(`
    INSERT INTO notification_reads (notification_id, user_id)
    VALUES (?, ?)
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `).run(parseInt(req.params.id), req.user.id);
  res.json({ message: '已标记为已读' });
});

// 全部标记已读（仅当前用户）
router.put('/read-all', authMiddleware, async (req, res) => {
  const db = getDb();
  const userId = req.user.id;
  const deptFilter = await buildDepartmentFilter(req.user, 'notifications');
  await db.prepare(`
    INSERT INTO notification_reads (notification_id, user_id)
    SELECT id, ? FROM notifications
    WHERE 1=1 ${deptFilter.sql}
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `).run(userId, ...deptFilter.params);
  res.json({ message: '已全部标记为已读' });
});

// 检查超期流程并生成通知
router.post('/check-overdue', authMiddleware, async (req, res) => {
  const db = getDb();
  const localNow = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const today = localNow.slice(0, 10);

  // 查找所有超期未完成的流程
  const overdueStages = await db.prepare(`
    SELECT ps.*, o.order_no
    FROM process_stages ps
    JOIN orders o ON ps.order_id = o.id
    WHERE ps.status NOT IN ('completed', 'cancelled')
      AND ps.planned_end_date IS NOT NULL
      AND (
        (ps.planned_end_date LIKE '%T%' AND ps.planned_end_date < ?)
        OR (ps.planned_end_date NOT LIKE '%T%' AND ps.planned_end_date < ?)
      )
      AND ps.department_id IS NOT NULL
  `).all(localNow, today);

  let created = 0;
  const newNotifs = [];
  for (const stage of overdueStages) {
    const sourceKey = `stage_overdue:${stage.id}`;
    const msg = `订单 ${stage.order_no} 的"${stage.stage_name}"已超期（计划 ${stage.planned_end_date}），请尽快处理！`;
    const result = await db.prepare(`
      INSERT INTO notifications (order_id, message, recipient_dept_id, source_key)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
    `).run(stage.order_id, msg, stage.department_id, sourceKey);

    if (result.changes > 0) {
      created++;
      newNotifs.push({ id: result.lastInsertRowid, message: msg, order_no: stage.order_no, stage_name: stage.stage_name });
    }
  }

  res.json({ checked: overdueStages.length, created, newNotifs });
});

module.exports = router;
