const STAGE_DEFINITIONS = require('../shared/stage-defs.json');
const STAGE_DURATIONS_DAYS = require('../shared/stage-durations.json');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date, days) {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dayDiff(from, to) {
  const [y1, m1, d1] = from.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = to.slice(0, 10).split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

function buildChildrenMap(stageDefs) {
  const children = new Map(stageDefs.map(s => [s.key, []]));
  for (const s of stageDefs) {
    for (const dep of String(s.dependsOn || '').split(',').map(k => k.trim()).filter(Boolean)) {
      if (!children.has(dep)) children.set(dep, []);
      children.get(dep).push(s.key);
    }
  }
  return children;
}

function collectDescendants(stageDefs, startKey) {
  const children = buildChildrenMap(stageDefs);
  const out = new Set();
  const stack = [startKey];
  while (stack.length) {
    const cur = stack.pop();
    for (const child of children.get(cur) || []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

// 按计划交货日期倒排建议：上游节点计划完成 = 下游最早可开始（关键路径）
function buildScheduleSuggestions(stageDefs, plannedDeliveryDate) {
  if (!plannedDeliveryDate || !DATE_RE.test(plannedDeliveryDate)) return {};
  const children = buildChildrenMap(stageDefs);
  const finish = {};
  for (const s of [...stageDefs].sort((a, b) => b.order - a.order)) {
    const next = children.get(s.key) || [];
    if (next.length === 0) {
      finish[s.key] = plannedDeliveryDate;
      continue;
    }
    finish[s.key] = next.reduce((min, key) => {
      const candidate = addDays(finish[key], -(STAGE_DURATIONS_DAYS[key] || 0));
      return min === null || candidate < min ? candidate : min;
    }, null);
  }
  const suggestions = {};
  for (const s of stageDefs) {
    const end = finish[s.key];
    if (!end) continue;
    const duration = STAGE_DURATIONS_DAYS[s.key] || 0;
    suggestions[s.key] = {
      start_date: duration > 0 ? addDays(end, -duration) : null,
      planned_end_date: end
    };
  }
  return suggestions;
}

function todayStr() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 倒排建议 + 防“建议日期早于今天”：最早开始早于 minStartDate 时整体顺延，并给出最早可交货日
function buildSchedulePlan(stageDefs, plannedDeliveryDate, minStartDate) {
  const suggestions = buildScheduleSuggestions(stageDefs, plannedDeliveryDate);
  const minStart = minStartDate || todayStr();
  const earliest = Object.values(suggestions)
    .map(s => s.start_date)
    .filter(Boolean)
    .sort()[0];
  if (earliest && earliest < minStart) {
    const delta = dayDiff(earliest, minStart);
    const shifted = {};
    for (const key of Object.keys(suggestions)) {
      shifted[key] = {
        start_date: suggestions[key].start_date ? addDays(suggestions[key].start_date, delta) : null,
        planned_end_date: addDays(suggestions[key].planned_end_date, delta)
      };
    }
    return { suggestions: shifted, shifted: true, achievedDeliveryDate: addDays(plannedDeliveryDate, delta) };
  }
  return { suggestions, shifted: false, achievedDeliveryDate: plannedDeliveryDate };
}

// 手工改期后计算下游建议与冲突（dates 为当前各节点计划日期，纯计算）
function computeDownstreamSuggestions(stageDefs, dates, changedKey, changedPlannedEnd) {
  const descendants = collectDescendants(stageDefs, changedKey);
  if (descendants.size === 0) return [];
  const sorted = stageDefs
    .filter(s => descendants.has(s.key))
    .sort((a, b) => a.order - b.order);
  const current = new Map(Object.entries(dates).map(([key, value]) => [key, { ...value }]));
  current.set(changedKey, { ...current.get(changedKey), planned_end_date: changedPlannedEnd });

  const result = [];
  for (const def of sorted) {
    const predKeys = String(def.dependsOn || '').split(',').map(k => k.trim()).filter(Boolean);
    const predEnds = predKeys.map(k => current.get(k)?.planned_end_date).filter(Boolean);
    if (predEnds.length === 0) continue;
    const maxPred = predEnds.reduce((a, b) => (a > b ? a : b));
    const duration = STAGE_DURATIONS_DAYS[def.key] || 0;
    const suggestedEnd = addDays(maxPred, duration);
    const suggestedStart = duration > 0 ? maxPred : null;
    const row = current.get(def.key) || {};
    result.push({
      stage_key: def.key,
      suggested_start: suggestedStart,
      suggested_end: suggestedEnd,
      conflict: !!(row.planned_end_date && row.planned_end_date.slice(0, 10) < suggestedEnd)
    });
    // 向下游传播建议值，使整条链保持一致
    current.set(def.key, { ...row, start_date: suggestedStart, planned_end_date: suggestedEnd });
  }
  return result;
}

module.exports = {
  STAGE_DURATIONS_DAYS,
  addDays,
  dayDiff,
  buildScheduleSuggestions,
  buildSchedulePlan,
  collectDescendants,
  computeDownstreamSuggestions
};
