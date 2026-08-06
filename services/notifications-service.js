const database = require('../database');
const { buildNotificationFilter } = require('../lib/dept-filter');
const { escalationDays } = require('../shared/overdue-escalation.json');

function dayDiff(from, to) {
  const [y1, m1, d1] = from.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = to.slice(0, 10).split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

async function listNotifications(user, query) {
  const db = database.getDb();
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
  const deptFilter = await buildNotificationFilter(user, 'n');
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
  const unreadDeptFilter = await buildNotificationFilter(user, 'n');
  unreadWhere += unreadDeptFilter.sql;
  unreadParams.push(...unreadDeptFilter.params);

  const unreadCount = await db.prepare(`SELECT COUNT(*) as cnt FROM notifications n ${unreadWhere}`).get(...unreadParams);
  return { status: 200, body: { notifications, unreadCount: unreadCount.cnt } };
}

async function markRead(user, id) {
  const db = database.getDb();
  const deptFilter = await buildNotificationFilter(user, 'notifications');
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
  const db = database.getDb();
  const userId = user.id;
  const deptFilter = await buildNotificationFilter(user, 'notifications');
  await db.prepare(`
    INSERT INTO notification_reads (notification_id, user_id)
    SELECT id, ? FROM notifications
    WHERE 1=1 ${deptFilter.sql}
    ON CONFLICT (notification_id, user_id) DO NOTHING
  `).run(userId, ...deptFilter.params);
  return { status: 200, body: { message: '已全部标记为已读' } };
}

async function checkOverdue() {
  const db = database.getDb();
  const localNow = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const today = localNow.slice(0, 10);

  const overdueStages = await db.prepare(`
    SELECT ps.*, o.order_no
    FROM process_stages ps
    JOIN orders o ON ps.order_id = o.id
    WHERE ps.status <> 'completed'
      AND ps.planned_end_date IS NOT NULL
      AND (
        (ps.planned_end_date LIKE '%T%' AND ps.planned_end_date < ?)
        OR (ps.planned_end_date NOT LIKE '%T%' AND ps.planned_end_date < ?)
      )
  `).all(localNow, today);

  const firstRecipient = stage => stage.department_id
    ? { dept_id: stage.department_id, role: null }
    : { dept_id: null, role: 'management' };

  async function escalationRecipient(stage) {
    if (stage.department_id) {
      const dept = await db.prepare('SELECT parent_id FROM departments WHERE id = ?').get(stage.department_id);
      if (dept && dept.parent_id) return { dept_id: dept.parent_id, role: null };
    }
    return { dept_id: null, role: 'management' };
  }

  async function insertNotification(stage, recipient, message, sourceKey) {
    const result = await db.prepare(`
      INSERT INTO notifications (order_id, message, recipient_dept_id, recipient_role, source_key)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
    `).run(stage.order_id, message, recipient.dept_id, recipient.role, sourceKey);
    if (result.changes > 0) {
      return { id: result.lastInsertRowid, message };
    }
    return null;
  }

  let created = 0;
  const newNotifs = [];
  for (const stage of overdueStages) {
    const planned = String(stage.planned_end_date || '').slice(0, 10);
    const first = await insertNotification(
      stage,
      firstRecipient(stage),
      `订单 ${stage.order_no} 的"${stage.stage_name}"已超期（计划 ${planned}），请尽快处理！`,
      `stage_overdue:${stage.id}`
    );
    if (first) {
      created++;
      newNotifs.push({ id: first.id, message: first.message, order_no: stage.order_no, stage_name: stage.stage_name });
    }

    const daysOverdue = dayDiff(planned, today);
    if (daysOverdue >= escalationDays) {
      const escalated = await insertNotification(
        stage,
        await escalationRecipient(stage),
        `订单 ${stage.order_no} 的"${stage.stage_name}"已连续超期 ${daysOverdue} 天，请上级关注！`,
        `stage_overdue_escalated:${stage.id}`
      );
      if (escalated) {
        created++;
        newNotifs.push({ id: escalated.id, message: escalated.message, order_no: stage.order_no, stage_name: stage.stage_name });
      }
    }
  }

  return { status: 200, body: { checked: overdueStages.length, created, newNotifs } };
}

module.exports = { listNotifications, markRead, markAllRead, checkOverdue };
