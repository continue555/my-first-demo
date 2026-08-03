export function canOperateStage(user, stage) {
  if (!user || !stage) return false;
  const role = user.role;
  if (role === 'admin' || role === 'management') return true;
  const deptId = stage.department_id;
  if (!deptId) return false;
  if (role === 'sales' && deptId === 1) return true;
  if (role === 'finance' && deptId === 3) return true;
  if ((role === 'mold' || role === 'material_follow') && deptId === user.department_id) return true;
  if (role === 'production') {
    const childIds = user.child_dept_ids || [];
    return deptId === user.department_id || childIds.includes(deptId);
  }
  return false;
}

export function isUserDept(user, deptId) {
  if (!user || !deptId) return false;
  if (user.role === 'admin' || user.role === 'management') return true;
  if (user.role === 'mold' || user.role === 'material_follow') return deptId === user.department_id;
  const childIds = user.child_dept_ids || [];
  return deptId === user.department_id || childIds.includes(deptId);
}
