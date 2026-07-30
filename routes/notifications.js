const express = require('express');
const { getDb } = require('../database');
const { authMiddleware, getDepartmentTreeIds } = require('../middleware/auth');

const router = express.Router();

// 获取通知列表
router.get('/', authMiddleware, async (req, res) => {
  const db = getDb();
  const { unread, limit } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (unread === 'true') {
    where += ' AND n.is_read = 0';
  }

  // 按部门过滤（含子部门）
  if (req.user.role !== 'admin' && req.user.role !== 'management') {
    const deptIds = await getDepartmentTreeIds(req.user.department_id);
    const placeholders = deptIds.map(() => '?').join(',');
    where += ` AND n.recipient_dept_id IN (${placeholders})`;
    params.push(...deptIds);
  }

  const notifications = await db.prepare(`
    SELECT n.*, o.order_no
    FROM notifications n
    LEFT JOIN orders o ON n.order_id = o.id
    ${where}
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(...params, parseInt(limit) || 50);

  let unreadWhere = 'WHERE n.is_read = 0';
  const unreadParams = [];
  if (req.user.role !== 'admin' && req.user.role !== 'management') {
    const deptIds = await getDepartmentTreeIds(req.user.department_id);
    const placeholders = deptIds.map(() => '?').join(',');
    unreadWhere += ` AND n.recipient_dept_id IN (${placeholders})`;
    unreadParams.push(...deptIds);
  }

  const unreadCount = await db.prepare(`
    SELECT COUNT(*) as cnt FROM notifications n ${unreadWhere}
  `).get(...unreadParams);

  res.json({ notifications, unreadCount: unreadCount.cnt });
});

// 标记已读
router.put('/:id/read', authMiddleware, async (req, res) => {
  const db = getDb();
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: '已标记为已读' });
});

// 全部标记已读
router.put('/read-all', authMiddleware, async (req, res) => {
  const db = getDb();
  if (req.user.role !== 'admin' && req.user.role !== 'management') {
    const deptIds = await getDepartmentTreeIds(req.user.department_id);
    const placeholders = deptIds.map(() => '?').join(',');
    await db.prepare(`UPDATE notifications SET is_read = 1 WHERE recipient_dept_id IN (${placeholders})`).run(...deptIds);
  } else {
    await db.prepare('UPDATE notifications SET is_read = 1').run();
  }
  res.json({ message: '已全部标记为已读' });
});

// 检查超期流程并生成通知
router.post('/check-overdue', authMiddleware, async (req, res) => {
  const db = getDb();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // 查找所有超期未完成的流程
  const overdueStages = await db.prepare(`
    SELECT ps.*, o.order_no
    FROM process_stages ps
    JOIN orders o ON ps.order_id = o.id
    WHERE ps.status NOT IN ('completed', 'cancelled')
      AND ps.planned_end_date IS NOT NULL
      AND ps.planned_end_date < ?
      AND ps.department_id IS NOT NULL
  `).all(today);

  let created = 0;
  const newNotifs = [];
  for (const stage of overdueStages) {
    // 检查是否已有未读通知（避免重复）
    const existing = await db.prepare(`
      SELECT COUNT(*) as cnt FROM notifications
      WHERE order_id = ? AND message LIKE ? AND is_read = 0
    `).get(stage.order_id, `%${stage.stage_name}%超期%`);

    if (existing.cnt === 0) {
      const msg = `订单 ${stage.order_no} 的"${stage.stage_name}"已超期（计划 ${stage.planned_end_date}），请尽快处理！`;
      const result = await db.prepare(`
        INSERT INTO notifications (order_id, message, recipient_dept_id)
        VALUES (?, ?, ?)
      `).run(stage.order_id, msg, stage.department_id);
      created++;
      newNotifs.push({ id: result.lastInsertRowid, message: msg, order_no: stage.order_no, stage_name: stage.stage_name });
    }
  }

  res.json({ checked: overdueStages.length, created, newNotifs });
});

module.exports = router;