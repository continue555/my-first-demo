const database = require('../database');
const STAGE_DEFINITIONS = require('../shared/stage-defs.json');
const {
  buildScheduleSuggestions,
  computeDownstreamSuggestions,
  collectDescendants,
  addDays,
  dayDiff
} = require('../lib/stage-scheduler');

function getDb() {
  return database.getDb();
}

// 按计划交货日期写入建议日期；overwrite=false 时只补未设置的计划日期
async function applyDeliverySchedule(db, orderId, plannedDeliveryDate, overwrite) {
  const suggestions = buildScheduleSuggestions(STAGE_DEFINITIONS, plannedDeliveryDate);
  if (Object.keys(suggestions).length === 0) return { written: 0 };
  const stages = await db.prepare(
    'SELECT stage_key, start_date, planned_end_date FROM process_stages WHERE order_id = ?'
  ).all(orderId);
  let written = 0;
  for (const row of stages) {
    const sug = suggestions[row.stage_key];
    if (!sug) continue;
    const nextStart = overwrite ? sug.start_date : (row.start_date ?? sug.start_date);
    const nextPlanned = overwrite ? sug.planned_end_date : (row.planned_end_date ?? sug.planned_end_date);
    if (nextStart === row.start_date && nextPlanned === row.planned_end_date) continue;
    await db.prepare(`
      UPDATE process_stages SET start_date = ?, planned_end_date = ?, planned_end_source = 'auto', updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(nextStart, nextPlanned, orderId, row.stage_key);
    written++;
  }
  return { written };
}

// 手工改期后自动重算下游：未设置的下游写入建议值，已有且早于上游的仅返回冲突提示
async function recomputeDownstream(db, orderId, changedStageKey, changedPlannedEnd) {
  const stages = await db.prepare(
    'SELECT stage_key, start_date, planned_end_date FROM process_stages WHERE order_id = ?'
  ).all(orderId);
  const dates = {};
  for (const s of stages) dates[s.stage_key] = { start_date: s.start_date, planned_end_date: s.planned_end_date };
  const suggestions = computeDownstreamSuggestions(STAGE_DEFINITIONS, dates, changedStageKey, changedPlannedEnd);
  const warnings = [];
  for (const item of suggestions) {
    if (item.conflict) {
      const def = STAGE_DEFINITIONS.find(d => d.key === item.stage_key);
      warnings.push(`下游节点"${def ? def.name : item.stage_key}"的计划完成日期早于上游，建议不早于 ${item.suggested_end}`);
      continue;
    }
    await db.prepare(`
      UPDATE process_stages SET
        start_date = COALESCE(?, start_date),
        planned_end_date = COALESCE(?, planned_end_date),
        updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(item.suggested_start, item.suggested_end, orderId, item.stage_key);
  }
  return warnings;
}

// 实际完成/开始相对计划变化时，顺延或提前下游未开始且非手工设置的节点
async function shiftDownstreamForActual(db, orderId, stageKey, actualDate, plannedDate, options = {}) {
  const { type = 'completion', stageName = stageKey } = options;
  if (!actualDate || !plannedDate) return { shifted: 0, notificationCount: 0 };
  const delta = dayDiff(plannedDate, actualDate);
  if (!Number.isFinite(delta) || delta === 0) return { shifted: 0, notificationCount: 0 };
  if (type === 'start' && delta < 0) return { shifted: 0, notificationCount: 0 };

  const descendants = collectDescendants(STAGE_DEFINITIONS, stageKey);
  if (descendants.size === 0) return { shifted: 0, notificationCount: 0 };
  const placeholders = [...descendants].map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT ps.stage_key, ps.stage_name, ps.status, ps.start_date, ps.planned_end_date,
           ps.planned_end_source, ps.department_id
    FROM process_stages ps
    WHERE ps.order_id = ? AND ps.stage_key IN (${placeholders})
  `).all(orderId, ...descendants);

  const order = await db.prepare('SELECT order_no FROM orders WHERE id = ?').get(orderId);
  const orderNo = order && order.order_no ? order.order_no : String(orderId);
  const action = type === 'completion' ? '实际完成' : '实际开始';
  const verb = delta > 0 ? `推迟 ${delta} 天` : `提前 ${Math.abs(delta)} 天`;
  const affected = [];

  for (const row of rows) {
    if (row.status !== 'pending' || row.planned_end_source === 'manual' || !row.planned_end_date) continue;
    const nextPlanned = addDays(row.planned_end_date, delta);
    const nextStart = row.start_date ? addDays(row.start_date, delta) : null;
    await db.prepare(`
      UPDATE process_stages SET start_date = ?, planned_end_date = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(nextStart, nextPlanned, orderId, row.stage_key);
    affected.push({ row, nextPlanned });
  }

  const byRecipient = new Map();
  for (const item of affected) {
    const key = item.row.department_id ? `dept:${item.row.department_id}` : 'role:management';
    if (!byRecipient.has(key)) {
      byRecipient.set(key, {
        dept_id: item.row.department_id || null,
        role: item.row.department_id ? null : 'management',
        stages: []
      });
    }
    byRecipient.get(key).stages.push(`${item.row.stage_name}（${item.nextPlanned}）`);
  }

  let notificationCount = 0;
  for (const [key, recipient] of byRecipient) {
    const message = `订单 ${orderNo} 的"${stageName}"${action}${verb}，已自动调整下游：${recipient.stages.join('、')}（可手工修改）`;
    const result = await db.prepare(`
      INSERT INTO notifications (order_id, message, recipient_dept_id, recipient_role, source_key)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
    `).run(
      orderId,
      message,
      recipient.dept_id,
      recipient.role,
      `schedule_shift:${orderId}:${stageKey}:${key}:${String(actualDate).slice(0, 10)}`
    );
    if (result.changes > 0) notificationCount++;
  }

  return { shifted: affected.length, notificationCount };
}

module.exports = { applyDeliverySchedule, recomputeDownstream, shiftDownstreamForActual };
