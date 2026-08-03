const test = require('node:test');
const assert = require('node:assert');
const { getOverdueInfo } = require('../lib/overdue');

test('pending stage past planned date is overdue', () => {
  const r = getOverdueInfo({ status: 'in_progress', planned_end_date: '2026-07-01 09:00' });
  assert.equal(r.cssClass, 'overdue-red');
});

test('future planned date is not overdue', () => {
  const r = getOverdueInfo({ status: 'in_progress', planned_end_date: '2026-09-01 09:00' });
  assert.equal(r, null);
});

test('completed on time is marked on time', () => {
  const r = getOverdueInfo({
    status: 'completed',
    planned_end_date: '2026-08-02 09:00',
    actual_end_date: '2026-08-01 09:00'
  });
  assert.equal(r.cssClass, 'overdue-green');
});

test('completed late is overdue', () => {
  const r = getOverdueInfo({
    status: 'completed',
    planned_end_date: '2026-08-01 09:00',
    actual_end_date: '2026-08-02 09:00'
  });
  assert.equal(r.cssClass, 'overdue-red');
});

test('cancelled order is never overdue', () => {
  assert.equal(getOverdueInfo({ status: 'cancelled', planned_end_date: '2026-07-01' }), null);
});

test('missing planned date returns null', () => {
  assert.equal(getOverdueInfo({ status: 'pending' }), null);
});
