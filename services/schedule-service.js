const database = require('../database');
const STAGE_DEFINITIONS = require('../shared/stage-defs.json');
const { buildScheduleSuggestions, computeDownstreamSuggestions } = require('../lib/stage-scheduler');

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
      UPDATE process_stages SET start_date = ?, planned_end_date = ?, updated_at = datetime('now', '+8 hours')
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

module.exports = { applyDeliverySchedule, recomputeDownstream };
