const STAGE_DEFINITIONS = require('../shared/stage-defs.json');
const { getOverdueInfo } = require('./overdue');

// 取订单第一个未完成节点（按 stage_order），返回展示所需的聚合字段
function buildCurrentStage(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const sorted = [...stages].sort(
    (a, b) => (a.stage_order ?? Number.MAX_SAFE_INTEGER) - (b.stage_order ?? Number.MAX_SAFE_INTEGER)
  );
  const stage = sorted.find(s => s.status !== 'completed');
  if (!stage) return null;
  const def = STAGE_DEFINITIONS.find(d => d.key === stage.stage_key);
  return {
    stage_key: stage.stage_key,
    stage_name: stage.stage_name || def?.name || stage.stage_key,
    department_id: stage.department_id ?? def?.deptId ?? null,
    dept_name: stage.dept_name || null,
    planned_end_date: stage.planned_end_date || null,
    overdue: !!getOverdueInfo(stage)
  };
}

module.exports = { buildCurrentStage };
