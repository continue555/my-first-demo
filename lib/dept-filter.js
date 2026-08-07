const { getDepartmentTreeIds } = require('../middleware/auth');

// 通知可见性：部门树匹配，或按角色直投（如总经理签字通知）
async function buildNotificationFilter(user, alias = 'n') {
  if (!user || user.role === 'admin' || user.role === 'management') {
    return { sql: '', params: [] };
  }
  const deptIds = await getDepartmentTreeIds(user.department_id);
  const placeholders = deptIds.map(() => '?').join(',');
  return {
    sql: ` AND (${alias}.recipient_dept_id IN (${placeholders}) OR ${alias}.recipient_role = ?)`,
    params: [...deptIds, user.role]
  };
}

module.exports = { buildNotificationFilter };
