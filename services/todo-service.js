const database = require('../database');
const { canOperateStage } = require('../lib/stage-permissions');
const { buildCurrentStage } = require('../lib/current-stage');

function getDb() {
  return database.getDb();
}

async function dependenciesCompleted(db, orderId, dependsOn) {
  const depKeys = String(dependsOn || '').split(',').map(k => k.trim()).filter(Boolean);
  if (depKeys.length === 0) return true;
  const placeholders = depKeys.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT status FROM process_stages WHERE order_id = ? AND stage_key IN (${placeholders})`
  ).all(orderId, ...depKeys);
  return rows.length === depKeys.length && rows.every(r => r.status === 'completed');
}

async function listMyTodos(user) {
  const db = getDb();
  const orders = await db.prepare(`
    SELECT id, order_no, status, planned_delivery_date
    FROM orders
    ORDER BY id DESC
  `).all();

  const todos = [];
  for (const order of orders) {
    const stages = await db.prepare(`
      SELECT ps.stage_key, ps.stage_name, ps.stage_order, ps.department_id, ps.status,
             ps.depends_on, ps.start_date, ps.planned_end_date, ps.actual_end_date,
             d.name AS dept_name
      FROM process_stages ps
      LEFT JOIN departments d ON ps.department_id = d.id
      WHERE ps.order_id = ?
      ORDER BY ps.stage_order
    `).all(order.id);

    const current = buildCurrentStage(stages);
    if (!current) continue;
    const currentRow = stages.find(s => s.stage_key === current.stage_key);
    if (!(await canOperateStage(user, currentRow))) continue;

    let category = null;
    if (currentRow.status === 'in_progress') {
      category = 'in_progress';
    } else if (currentRow.status === 'pending' && await dependenciesCompleted(db, order.id, currentRow.depends_on)) {
      category = 'ready';
    }
    if (!category) continue;

    todos.push({
      order_id: order.id,
      order_no: order.order_no,
      category,
      stage_key: current.stage_key,
      stage_name: current.stage_name,
      department_id: current.department_id,
      dept_name: current.dept_name,
      planned_end_date: current.planned_end_date,
      overdue: current.overdue
    });
  }

  todos.sort((a, b) => (b.overdue - a.overdue) || (a.order_id - b.order_id));
  return { status: 200, body: { todos } };
}

module.exports = { listMyTodos, dependenciesCompleted };
