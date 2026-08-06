const SHIFT_KEY_RE = /^schedule_shift:(\d+):([^:]+):(?:dept:\d+|role:[^:]+):(\d{4}-\d{2}-\d{2})$/;

export function shiftGroupKey(notification) {
  if (!notification || typeof notification.source_key !== 'string') return null;
  const m = notification.source_key.match(SHIFT_KEY_RE);
  if (!m) return null;
  return `shift:${m[1]}:${m[2]}:${m[3]}`;
}

export function buildShiftSummary(items) {
  const first = items[0] || {};
  const head = String(first.message || '').split('已自动调整下游')[0];
  return `${head}已自动调整下游并通知 ${items.length} 个部门（展开查看）`;
}

// 顺延/提前通知按“同一订单 + 同一节点 + 同一日期事件”折叠，其余通知保持单条
export function groupNotifications(list) {
  const groups = [];
  let current = null;
  for (const n of list || []) {
    const key = shiftGroupKey(n);
    if (key && current && current.key === key) {
      current.items.push(n);
      current.allRead = current.allRead && !!n.is_read;
      current.summary = buildShiftSummary(current.items);
      continue;
    }
    if (key) {
      current = { key, type: 'shift', items: [n], allRead: !!n.is_read, summary: buildShiftSummary([n]) };
    } else {
      current = { key: `id:${n.id}`, type: 'single', items: [n], allRead: !!n.is_read };
    }
    groups.push(current);
  }
  return groups;
}
