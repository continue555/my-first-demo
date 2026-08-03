const { getDepartmentTreeIds } = require('../middleware/auth');

async function buildDepartmentFilter(user, alias = 'n') {
  if (!user || user.role === 'admin' || user.role === 'management') {
    return { sql: '', params: [] };
  }
  const deptIds = await getDepartmentTreeIds(user.department_id);
  const placeholders = deptIds.map(() => '?').join(',');
  return {
    sql: ` AND ${alias}.recipient_dept_id IN (${placeholders})`,
    params: deptIds
  };
}

module.exports = { buildDepartmentFilter };
