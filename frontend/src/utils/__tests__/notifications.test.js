import { describe, it, expect } from 'vitest';
import { groupNotifications, shiftGroupKey, buildShiftSummary } from '@/utils/notifications';

const shift = (orderId, stage, date, recipient, id, isRead = 0) => ({
  id,
  order_id: orderId,
  order_no: `ORD-${orderId}`,
  message: `订单 ORD-${orderId} 的"${stage}"实际完成提前 1 天，已自动调整下游：${recipient}（2026-09-01）（可手工修改）`,
  source_key: `schedule_shift:${orderId}:${stage}:dept:${recipient === 'management' ? 0 : recipient}:${date}`,
  is_read: isRead
});

describe('notification grouping', () => {
  it('groups shift notifications of the same event', () => {
    const list = [
      shift(1, 'gm_sign', '2026-08-06', 3, 10),
      shift(1, 'gm_sign', '2026-08-06', 5, 11),
      shift(1, 'gm_sign', '2026-08-06', 8, 12)
    ];
    const groups = groupNotifications(list);
    expect(groups.length).toBe(1);
    expect(groups[0].type).toBe('shift');
    expect(groups[0].items.length).toBe(3);
    expect(groups[0].summary).toContain('3 个部门');
  });

  it('keeps different events and single notifications separate', () => {
    const list = [
      { id: 1, message: '普通通知', source_key: 'stage_completed:1:contract_sign:dept:1', is_read: 0 },
      shift(1, 'gm_sign', '2026-08-06', 3, 10),
      shift(1, 'gm_sign', '2026-08-07', 3, 11),
      shift(2, 'gm_sign', '2026-08-06', 3, 12)
    ];
    const groups = groupNotifications(list);
    expect(groups.length).toBe(4);
    expect(groups[0].type).toBe('single');
  });

  it('merges same event even when other notifications sit between', () => {
    const list = [
      shift(1, 'gm_sign', '2026-08-06', 3, 10),
      { id: 20, message: '中间通知', source_key: 'stage_completed:1:contract_sign:dept:1', is_read: 0 },
      shift(1, 'gm_sign', '2026-08-06', 5, 11)
    ];
    const groups = groupNotifications(list);
    const shiftGroups = groups.filter(g => g.type === 'shift');
    expect(shiftGroups.length).toBe(1);
    expect(shiftGroups[0].items.length).toBe(2);
  });

  it('computes group read state from all children', () => {
    const list = [
      shift(1, 'gm_sign', '2026-08-06', 3, 10, 0),
      shift(1, 'gm_sign', '2026-08-06', 5, 11, 1)
    ];
    const groups = groupNotifications(list);
    expect(groups[0].allRead).toBe(false);
  });

  it('shiftGroupKey rejects non-shift notifications', () => {
    expect(shiftGroupKey({ source_key: 'stage_completed:1:contract_sign:dept:1' })).toBeNull();
  });

  it('buildShiftSummary keeps event prefix', () => {
    const summary = buildShiftSummary([shift(1, 'gm_sign', '2026-08-06', 3, 10)]);
    expect(summary).toContain('"gm_sign"实际完成提前 1 天');
  });
});
