export function statusText(s) {
  const m = { pending: '未开始', in_progress: '进行中', completed: '已完成', delayed: '已延期', cancelled: '已取消' };
  return m[s] || s;
}

export function getOverdueInfo(obj) {
  if (!obj) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const planned = obj.planned_end_date || obj.planned_delivery_date;
  const actual = obj.actual_end_date || obj.actual_delivery_date;
  const status = obj.status;
  const plannedDate = planned ? new Date(planned) : null;
  const actualDate = actual ? new Date(actual) : null;
  if (plannedDate) plannedDate.setHours(0, 0, 0, 0);
  if (actualDate) actualDate.setHours(0, 0, 0, 0);
  if (status !== 'completed' && status !== 'cancelled' && plannedDate && plannedDate < now) {
    return { cssClass: 'overdue-red', rowClass: 'overdue-red-row', stampClass: 'overdue-red-stamp', stampText: '超期' };
  }
  if (status === 'completed' && actualDate && plannedDate && actualDate > plannedDate) {
    return { cssClass: 'overdue-red', rowClass: 'overdue-red-row', stampClass: 'overdue-red-stamp', stampText: '超期' };
  }
  if (status === 'completed' && actualDate && plannedDate && actualDate <= plannedDate) {
    return { cssClass: 'overdue-green', rowClass: 'overdue-green-row', stampClass: 'overdue-green-stamp', stampText: '如期' };
  }
  return null;
}