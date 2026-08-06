process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const { shiftDownstreamForActual } = require('../services/schedule-service');
const { updateStageTime } = require('../services/order-service');

function fakeDb({ stages, order, getStage }) {
  const runs = [];
  const inserted = new Set();
  return {
    runs,
    prepare(sql) {
      return {
        async get(...params) {
          if (sql.includes('FROM orders')) return order || { id: 1, order_no: 'ORD-1' };
          if (sql.includes('FROM process_stages') && getStage) return getStage(params[0], params[1]);
          return null;
        },
        async all(...params) {
          if (sql.includes('stage_key IN')) {
            const keys = params.slice(1);
            return (stages || []).filter(s => keys.includes(s.stage_key));
          }
          return stages || [];
        },
        async run(...params) {
          runs.push({ sql, params });
          if (sql.includes('INSERT INTO notifications')) {
            const sourceKey = params[4];
            if (inserted.has(sourceKey)) return { changes: 0, lastInsertRowid: null };
            inserted.add(sourceKey);
            return { changes: 1, lastInsertRowid: runs.length };
          }
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

const admin = { id: 1, name: '管理员', role: 'admin', department_id: null };

const baseStages = () => [
  { stage_key: 'material_in', stage_name: '物料进仓', status: 'completed', start_date: null, planned_end_date: '2026-08-01', planned_end_source: 'auto', department_id: 6 },
  { stage_key: 'warehouse_prepare', stage_name: '仓库配料', status: 'pending', start_date: '2026-08-02', planned_end_date: '2026-08-03', planned_end_source: 'auto', department_id: 6 },
  { stage_key: 'assembly', stage_name: '装配', status: 'pending', start_date: '2026-08-03', planned_end_date: '2026-08-08', planned_end_source: 'auto', department_id: 7 },
  { stage_key: 'debug', stage_name: '调试验收', status: 'pending', start_date: '2026-08-08', planned_end_date: '2026-08-11', planned_end_source: 'auto', department_id: 8 },
  { stage_key: 'shipping', stage_name: '发货', status: 'pending', start_date: null, planned_end_date: '2026-08-09', planned_end_source: 'auto', department_id: 9 },
  { stage_key: 'delivery_payment', stage_name: '提货款到账', status: 'pending', start_date: null, planned_end_date: '2026-08-09', planned_end_source: 'auto', department_id: 3 }
];

test('late completion pushes pending auto downstream by same days', async () => {
  const db = fakeDb({ stages: baseStages() });
  await withDb(db, async () => {
    const r = await shiftDownstreamForActual(db, 1, 'material_in', '2026-08-05', '2026-08-01', { type: 'completion' });
    assert.equal(r.shifted, 3);
    assert.equal(r.notificationCount, 3);
    const warehouseRun = db.runs.find(x => x.params.includes('warehouse_prepare') && x.sql.includes('UPDATE process_stages'));
    const assemblyRun = db.runs.find(x => x.params.includes('assembly') && x.sql.includes('UPDATE process_stages'));
    const debugRun = db.runs.find(x => x.params.includes('debug') && x.sql.includes('UPDATE process_stages'));
    assert.equal(warehouseRun.params[0], '2026-08-06');
    assert.equal(warehouseRun.params[1], '2026-08-07');
    assert.equal(assemblyRun.params[0], '2026-08-07');
    assert.equal(assemblyRun.params[1], '2026-08-12');
    assert.equal(debugRun.params[0], '2026-08-12');
    assert.equal(debugRun.params[1], '2026-08-15');
    assert.ok(!db.runs.some(x => x.params.includes('shipping')));
    assert.ok(!db.runs.some(x => x.params.includes('delivery_payment')));
  });
});

test('early completion pulls pending auto downstream earlier', async () => {
  const db = fakeDb({ stages: baseStages() });
  await withDb(db, async () => {
    const r = await shiftDownstreamForActual(db, 1, 'material_in', '2026-07-30', '2026-08-01', { type: 'completion' });
    assert.equal(r.shifted, 3);
    const warehouseRun = db.runs.find(x => x.params.includes('warehouse_prepare') && x.sql.includes('UPDATE process_stages'));
    assert.equal(warehouseRun.params[0], '2026-07-31');
    assert.equal(warehouseRun.params[1], '2026-08-01');
  });
});

test('manual downstream planned date is not overwritten', async () => {
  const stages = baseStages();
  stages[1].planned_end_source = 'manual'; // warehouse_prepare
  const db = fakeDb({ stages });
  await withDb(db, async () => {
    const r = await shiftDownstreamForActual(db, 1, 'material_in', '2026-08-05', '2026-08-01', { type: 'completion' });
    assert.equal(r.shifted, 2);
    assert.ok(!db.runs.some(x => x.params.includes('warehouse_prepare') && x.sql.includes('UPDATE process_stages')));
  });
});

test('started downstream stage is not shifted', async () => {
  const stages = baseStages();
  stages[2].status = 'in_progress'; // assembly
  const db = fakeDb({ stages });
  await withDb(db, async () => {
    const r = await shiftDownstreamForActual(db, 1, 'material_in', '2026-08-05', '2026-08-01', { type: 'completion' });
    assert.equal(r.shifted, 2);
    assert.ok(!db.runs.some(x => x.params.includes('assembly')));
  });
});

test('late start pushes downstream, early start does not', async () => {
  const db = fakeDb({ stages: baseStages() });
  await withDb(db, async () => {
    const late = await shiftDownstreamForActual(db, 1, 'material_in', '2026-08-05', '2026-08-01', { type: 'start' });
    assert.equal(late.shifted, 3);
  });
  const db2 = fakeDb({ stages: baseStages() });
  await withDb(db2, async () => {
    const early = await shiftDownstreamForActual(db2, 1, 'material_in', '2026-07-30', '2026-08-01', { type: 'start' });
    assert.equal(early.shifted, 0);
  });
});

test('shift notifications deduplicate across repeated runs', async () => {
  const db = fakeDb({ stages: baseStages() });
  await withDb(db, async () => {
    const r1 = await shiftDownstreamForActual(db, 1, 'material_in', '2026-08-05', '2026-08-01', { type: 'completion' });
    const r2 = await shiftDownstreamForActual(db, 1, 'material_in', '2026-08-05', '2026-08-01', { type: 'completion' });
    assert.equal(r1.notificationCount, 3);
    assert.equal(r2.notificationCount, 0);
  });
});

test('updateStageTime marks planned end as manual', async () => {
  const db = fakeDb({
    getStage: () => ({ id: 1, stage_key: 'contract_sign', department_id: 1, status: 'pending', start_date: null, planned_end_date: null })
  });
  await withDb(db, async () => {
    const r = await updateStageTime(admin, 1, 'contract_sign', { start_date: '2026-08-01', planned_end_date: '2026-08-02' });
    assert.equal(r.status, 200);
    const update = db.runs.find(x => x.sql.includes('planned_end_source'));
    assert.ok(update);
    assert.ok(update.sql.includes("planned_end_source = 'manual'"));
  });
});
