async function canOperateStage(user, stage) {
  if (!user || !stage) return false;
  if (user.role === 'admin' || user.role === 'management') return true;
  const deptId = stage.department_id;
  if (!deptId) return false;
  if (user.role === 'sales' && deptId === 1) return true;
  if (user.role === 'finance' && deptId === 3) return true;
  if ((user.role === 'mold' || user.role === 'material_follow') && deptId === user.department_id) return true;
  if (user.role === 'production') {
    const { getDepartmentTreeIds } = require('../middleware/auth');
    const childDeptIds = await getDepartmentTreeIds(user.department_id);
    return deptId === user.department_id || childDeptIds.includes(deptId);
  }
  return false;
}

function isUserDept(user, deptId) {
  if (!user || !deptId) return false;
  if (user.role === 'admin' || user.role === 'management') return true;
  if (user.role === 'mold' || user.role === 'material_follow') return deptId === user.department_id;
  const childIds = user.child_dept_ids || [];
  return deptId === user.department_id || childIds.includes(deptId);
}

module.exports = { canOperateStage, isUserDept };
