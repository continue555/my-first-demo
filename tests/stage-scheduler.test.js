process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const stageDefs = require('../shared/stage-defs.json');
const STAGE_DURATIONS_DAYS = require('../shared/stage-durations.json');
const { buildScheduleSuggestions, computeDownstreamSuggestions } = require('../lib/stage-scheduler');
const { applyDeliverySchedule, recomputeDownstream } = require('../services/schedule-service');
const { createOrder } = require('../services/order-service');

function fakeDb({ stages }) {
  const runs = [];
  return {
    runs,
    prepare(sql) {
      return {
        async get() {
          return null;
        },
        async all() {
          return stages || [];
        },
        async run(...params) {
          runs.push({ sql, params });
          return { changes: 1, lastInsertRowid: 1 };
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

test('duration config covers every stage', () => {
  assert.equal(Object.keys(STAGE_DURATIONS_DAYS).length, stageDefs.length);
  for (const s of stageDefs) {
    assert.ok(Number.isInteger(STAGE_DURATIONS_DAYS[s.key]) && STAGE_DURATIONS_DAYS[s.key] >= 0, `bad duration for ${s.key}`);
  }
});

test('backward schedule computes serial chain and critical path', () => {
  const plan = buildScheduleSuggestions(stageDefs, '2026-08-10');
  assert.equal(Object.keys(plan).length, stageDefs.length);
  assert.equal(plan.shipping.planned_end_date, '2026-08-10');
  assert.equal(plan.shipping.start_date, '2026-08-09');
  assert.equal(plan.debug.planned_end_date, '2026-08-10');
  assert.equal(plan.assembly.planned_end_date, '2026-08-07');
  assert.equal(plan.material_in.planned_end_date, '2026-08-01');
  for (const key of ['purchase_frame', 'purchase_mold_frame', 'purchase_electrical', 'purchase_cover', 'mold_design_purchase']) {
    assert.equal(plan[key].planned_end_date, '2026-08-01', key);
  }
  assert.equal(plan.purchase_plan.planned_end_date, '2026-07-07');
  assert.equal(plan.contract_sign.start_date, '2026-06-27');
  assert.equal(plan.delivery_payment.start_date, null);
  assert.equal(plan.frame_follow_up.start_date, null);
});

test('manual change recomputes downstream and flags conflict', () => {
  const dates = {
    delivery_payment: { start_date: null, planned_end_date: '2026-08-09' },
    shipping: { start_date: '2026-08-04', planned_end_date: '2026-08-04' },
    debug: { start_date: '2026-08-07', planned_end_date: '2026-08-10' }
  };
  const result = computeDownstreamSuggestions(stageDefs, dates, 'delivery_payment', '2026-08-05');
  const shipping = result.find(r => r.stage_key === 'shipping');
  assert.equal(shipping.suggested_end, '2026-08-06');
  assert.equal(shipping.conflict, true);
  assert.ok(!result.some(r => r.stage_key === 'debug'));
});

test('parallel purchases propagate latest arrival to material_in', () => {
  const dates = {
    frame_follow_up: { start_date: null, planned_end_date: '2026-08-25' },
    mold_frame_follow_up: { start_date: null, planned_end_date: '2026-08-20' },
    electrical_follow_up: { start_date: null, planned_end_date: '2026-08-20' },
    cover_follow_up: { start_date: null, planned_end_date: '2026-08-20' },
    mold_design_follow_up: { start_date: null, planned_end_date: '2026-08-20' },
    material_in: { start_date: null, planned_end_date: '2026-08-20' },
    warehouse_prepare: { start_date: null, planned_end_date: null },
    assembly: { start_date: null, planned_end_date: null },
    debug: { start_date: null, planned_end_date: null },
    shipping: { start_date: null, planned_end_date: null }
  };
  const result = computeDownstreamSuggestions(stageDefs, dates, 'frame_follow_up', '2026-08-25');
  const materialIn = result.find(r => r.stage_key === 'material_in');
  const warehouse = result.find(r => r.stage_key === 'warehouse_prepare');
  const assembly = result.find(r => r.stage_key === 'assembly');
  assert.equal(materialIn.suggested_end, '2026-08-25');
  assert.equal(materialIn.conflict, true);
  assert.equal(warehouse.suggested_end, '2026-08-26');
  assert.equal(assembly.suggested_end, '2026-08-31');
  assert.ok(!result.some(r => r.stage_key === 'shipping'));
});

test('applyDeliverySchedule fills unset dates and keeps existing', async () => {
  const stages = [
    { stage_key: 'contract_sign', start_date: null, planned_end_date: null },
    { stage_key: 'deposit_confirm', start_date: '2026-01-01', planned_end_date: '2026-01-02' },
    { stage_key: 'shipping', start_date: null, planned_end_date: null }
  ];
  const db = fakeDb({ stages });
  await withDb(db, async () => {
    const result = await applyDeliverySchedule(db, 1, '2026-08-10', false);
    assert.equal(result.written, 2);
    const shippingRun = db.runs.find(r => r.params.includes('shipping'));
    assert.equal(shippingRun.params[1], '2026-08-10');
    assert.ok(!db.runs.some(r => r.params.includes('deposit_confirm')));
  });
});

test('applyDeliverySchedule overwrites when explicitly requested', async () => {
  const stages = [
    { stage_key: 'deposit_confirm', start_date: '2026-01-01', planned_end_date: '2026-01-02' }
  ];
  const db = fakeDb({ stages });
  await withDb(db, async () => {
    await applyDeliverySchedule(db, 1, '2026-08-10', true);
    const run = db.runs.find(r => r.params.includes('deposit_confirm'));
    assert.equal(run.params[0], '2026-06-28');
    assert.equal(run.params[1], '2026-06-29');
  });
});

test('recomputeDownstream fills null downstream dates', async () => {
  const stages = [
    { stage_key: 'delivery_payment', start_date: null, planned_end_date: '2026-08-09' },
    { stage_key: 'shipping', start_date: null, planned_end_date: null },
    { stage_key: 'debug', start_date: null, planned_end_date: '2026-08-10' }
  ];
  const db = fakeDb({ stages });
  await withDb(db, async () => {
    const warnings = await recomputeDownstream(db, 1, 'delivery_payment', '2026-08-05');
    const shippingRun = db.runs.find(r => r.params.includes('shipping'));
    assert.ok(shippingRun);
    assert.equal(shippingRun.params[0], '2026-08-05');
    assert.equal(shippingRun.params[1], '2026-08-06');
    assert.equal(warnings.length, 0);
    assert.ok(!db.runs.some(r => r.params.includes('debug')));
  });
});

test('recomputeDownstream warns and keeps early existing downstream date', async () => {
  const stages = [
    { stage_key: 'delivery_payment', start_date: null, planned_end_date: '2026-08-09' },
    { stage_key: 'shipping', start_date: '2026-08-04', planned_end_date: '2026-08-05' }
  ];
  const db = fakeDb({ stages });
  await withDb(db, async () => {
    const warnings = await recomputeDownstream(db, 1, 'delivery_payment', '2026-08-05');
    assert.ok(warnings.some(w => w.includes('发货')));
    assert.ok(!db.runs.some(r => r.params.includes('shipping')));
  });
});

test('createOrder writes scheduled suggestion dates', async () => {
  const db = fakeDb({ stages: [] });
  await withDb(db, async () => {
    const r = await createOrder(admin, { customer_name: 'T', project_name: 'P', planned_delivery_date: '2026-08-10' });
    assert.equal(r.status, 201);
    const contract = db.runs.find(r => r.params.includes('contract_sign'));
    const shipping = db.runs.find(r => r.params.includes('shipping'));
    assert.equal(contract.params[7], '2026-06-27');
    assert.equal(contract.params[8], '2026-06-28');
    assert.equal(shipping.params[7], '2026-08-09');
    assert.equal(shipping.params[8], '2026-08-10');
  });
});
