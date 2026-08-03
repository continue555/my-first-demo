const { getDb } = require('../database');
const { buildDepartmentFilter } = require('../lib/dept-filter');

async function listNotifications(user, query) {
  const db = getDb();
  const { unread, limit } = query;
  const rawLimit = parseInt(limit, 10);
  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const userId = user.id;

  let where = 'WHERE 1=1';
  const params = [];
  if (unread === 'true') {
    where += ' AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = ?)';
    params.push(userId);
  }
  const deptFilter = await buildDepartmentFilter(user, 'n');
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
  `).all(userId, ...params, safeLimit);

  let unreadWhere = 'WHERE NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = ?)';
  const unreadParams = [userId];
  const unreadDeptFilter = await buildDepartmentFilter(user, 'n');
  unreadWhere += unreadDeptFilter.sql;
  unreadParams.push(...unreadDeptFilter.params);

  const unreadCount = await db.prepare(`SELECT COUNT(*) as cnt FROM notifications n ${unreadWhere}`).get(...unreadParams);
  return { status: 200, body: { notifications, unreadCount: unreadCount.cnt } };
}

async function markRead(user, id) {
  const db = getDb();
  const deptFilter = await buildDepartmentFilter(user, 'notifications');
  const notif = await db.prepare(`SELECT id FROM notifications WHERE id = ? ${deptFilter.sql}`).get(parseInt(id), ...deptFilter.params);
  if (!notif) return { status: 404, body: { error: '通知不存在' } };
  await db.prepare(`
    INSERT INTO notification_reads (notification_id, user_id)
    VALUES (?, ?)
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `).run(parseInt(id), user.id);
  return { status: 200, body: { message: '已标记为已读' } };
}

async function markAllRead(user) {
  const db = getDb();
  const userId = user.id;
  const deptFilter = await buildDepartmentFilter(user, 'notifications');
  await db.prepare(`
    INSERT INTO notification_reads (notification_id, user_id)
    SELECT id, ? FROM notifications
    WHERE 1=1 ${deptFilter.sql}
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `).run(userId, ...deptFilter.params);
  return { status: 200, body: { message: '已全部标记为已读' } };
}

async function checkOverdue() {
  const db = getDb();
  const localNow = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const today = localNow.slice(0, 10);

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

  return { status: 200, body: { checked: overdueStages.length, created, newNotifs } };
}

module.exports = { listNotifications, markRead, markAllRead, checkOverdue };
