import statusLabels from '@shared/status-labels.json';

export function statusText(s) {
  return statusLabels[s] || s;
}

export function getOverdueInfo(obj) {
  if (!obj) return null;
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const today = now.slice(0, 10);
  const planned = obj.planned_end_date || obj.planned_delivery_date;
  const actual = obj.actual_end_date || obj.actual_delivery_date;
  const status = obj.status;
  if (status !== 'completed' && planned) {
    const overdue = planned.includes('T') ? planned < now : planned.slice(0, 10) < today;
    if (overdue) {
      return { cssClass: 'overdue-red', rowClass: 'overdue-red-row', stampClass: 'overdue-red-stamp', stampText: '超期' };
    }
  }
  if (status === 'completed' && planned && actual) {
    const p = String(planned).slice(0, 10);
    const a = String(actual).slice(0, 10);
    if (a > p) {
      return { cssClass: 'overdue-red', rowClass: 'overdue-red-row', stampClass: 'overdue-red-stamp', stampText: '超期' };
    }
    if (a <= p) {
      return { cssClass: 'overdue-green', rowClass: 'overdue-green-row', stampClass: 'overdue-green-stamp', stampText: '如期' };
    }
  }
  return null;
}
