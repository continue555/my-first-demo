process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const { checkOverdue } = require('../services/notifications-service');
const { escalationDays } = require('../shared/overdue-escalation.json');

function dayStr(offsetDays) {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function fakeDb({ stages, parents }) {
  const inserted = new Set();
  const runs = [];
  return {
    runs,
    prepare(sql) {
      return {
        async all() {
          return stages || [];
        },
        async get(...params) {
          if (sql.includes('FROM departments')) {
            const row = (parents || []).find(p => p.id === params[0]);
            return row || { parent_id: null };
          }
          return null;
        },
        async run(...params) {
          runs.push({ sql, params });
          const sourceKey = params[params.length - 1];
          if (inserted.has(sourceKey)) return { changes: 0, lastInsertRowid: null };
          inserted.add(sourceKey);
          return { changes: 1, lastInsertRowid: runs.length };
        }
      };
    }
  };
}

function withDb(db, fn) {
  const original = database.getDb;
  database.getDb = () => db;
  return fn().finally(() => { database.getDb = original; });
}

const baseStage = overrides => ({
  id: 1,
  order_id: 7,
  order_no: 'ORD-7',
  stage_key: 'purchase_plan',
  stage_name: '采购计划制定',
  planned_end_date: dayStr(-1),
  department_id: 5,
  status: 'in_progress',
  ...overrides
});

test('overdue escalation threshold is configurable', () => {
  assert.ok(Number.isInteger(escalationDays) && escalationDays > 0);
});

test('below threshold notifies responsible department once', async () => {
  const db = fakeDb({ stages: [baseStage({ planned_end_date: dayStr(-(escalationDays - 1)) })] });
  await withDb(db, async () => {
    const r1 = await checkOverdue();
    assert.equal(r1.body.created, 1);
    const r2 = await checkOverdue();
    assert.equal(r2.body.created, 0);
  });
});

test('above threshold adds escalated notification to parent department', async () => {
  const db = fakeDb({
    stages: [baseStage({ planned_end_date: dayStr(-escalationDays) })],
    parents: [{ id: 5, parent_id: 2 }]
  });
  await withDb(db, async () => {
    const r = await checkOverdue();
    assert.equal(r.body.created, 2);
    const level1 = db.runs.find(x => x.params.includes('stage_overdue:1'));
    const escalated = db.runs.find(x => x.params.includes('stage_overdue_escalated:1'));
    assert.ok(level1);
    assert.equal(level1.params[2], 5);
    assert.ok(escalated);
    assert.equal(escalated.params[2], 2);
    assert.equal(escalated.params[3], null);
  });
});

test('above threshold escalates to management when department has no parent', async () => {
  const db = fakeDb({
    stages: [baseStage({ department_id: 1, planned_end_date: dayStr(-escalationDays) })],
    parents: [{ id: 1, parent_id: null }]
  });
  await withDb(db, async () => {
    const r = await checkOverdue();
    assert.equal(r.body.created, 2);
    const escalated = db.runs.find(x => x.params.includes('stage_overdue_escalated:1'));
    assert.equal(escalated.params[2], null);
    assert.equal(escalated.params[3], 'management');
  });
});

test('department-less stage notifies management role', async () => {
  const db = fakeDb({
    stages: [baseStage({ department_id: null, stage_key: 'gm_sign', planned_end_date: dayStr(-1) })]
  });
  await withDb(db, async () => {
    const r = await checkOverdue();
    assert.equal(r.body.created, 1);
    const level1 = db.runs.find(x => x.params.includes('stage_overdue:1'));
    assert.equal(level1.params[2], null);
    assert.equal(level1.params[3], 'management');
  });
});

test('escalation deduplicates across repeated runs', async () => {
  const db = fakeDb({
    stages: [baseStage({ planned_end_date: dayStr(-escalationDays) })],
    parents: [{ id: 5, parent_id: 2 }]
  });
  await withDb(db, async () => {
    const r1 = await checkOverdue();
    const r2 = await checkOverdue();
    assert.equal(r1.body.created, 2);
    assert.equal(r2.body.created, 0);
    const escalatedAttempts = db.runs.filter(x => x.params.includes('stage_overdue_escalated:1'));
    assert.equal(escalatedAttempts.length, 2);
  });
});
