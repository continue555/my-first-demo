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
  const groupByKey = new Map();
  for (const n of list || []) {
    const key = shiftGroupKey(n);
    if (key && groupByKey.has(key)) {
      const group = groupByKey.get(key);
      group.items.push(n);
      group.allRead = group.allRead && !!n.is_read;
      group.summary = buildShiftSummary(group.items);
      continue;
    }
    if (key) {
      const group = { key, type: 'shift', items: [n], allRead: !!n.is_read, summary: buildShiftSummary([n]) };
      groupByKey.set(key, group);
      groups.push(group);
    } else {
      groups.push({ key: `id:${n.id}`, type: 'single', items: [n], allRead: !!n.is_read });
    }
  }
  return groups;
}
