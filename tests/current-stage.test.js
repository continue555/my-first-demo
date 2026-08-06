process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const { buildCurrentStage } = require('../lib/current-stage');
const { listOrders } = require('../services/order-service');
const { listMyTodos } = require('../services/todo-service');

function mkStage(key, status, extra = {}) {
  return {
    stage_key: key,
    stage_name: key,
    stage_order: 1,
    department_id: 1,
    status,
    depends_on: null,
    start_date: '2026-08-01',
    planned_end_date: '2026-08-10',
    actual_end_date: null,
    dept_name: '销售部门',
    ...extra
  };
}

function fakeDb({ orders, stagesByOrder, parentDepts }) {
  return {
    prepare(sql) {
      return {
        async get(...params) {
          if (sql.includes('COUNT(*)')) return { cnt: orders.length };
          return null;
        },
        async all(...params) {
          if (sql.includes('FROM orders o')) return orders;
          if (sql.includes('FROM orders')) return orders;
          if (sql.includes('FROM departments') && sql.includes('parent_id')) return parentDepts || [];
          if (sql.includes('FROM process_stages') && sql.includes('order_id = ?') && sql.includes('stage_key IN')) {
            const orderId = params[0];
            const keys = params.slice(1);
            const stages = stagesByOrder.get(orderId) || [];
            return stages.filter(s => keys.includes(s.stage_key)).map(s => ({ status: s.status }));
          }
          if (sql.includes('FROM process_stages') && sql.includes('order_id = ?')) {
            return stagesByOrder.get(params[0]) || [];
          }
          return [];
        },
        async run() {
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

test('buildCurrentStage returns first non-completed stage', () => {
  const current = buildCurrentStage([
    mkStage('contract_sign', 'completed', { stage_order: 1 }),
    mkStage('deposit_confirm', 'pending', {
      stage_order: 2,
      department_id: 3,
      dept_name: '财务部门',
      stage_name: '财务确认定金',
      planned_end_date: '2026-08-20'
    })
  ]);
  assert.equal(current.stage_key, 'deposit_confirm');
  assert.equal(current.stage_name, '财务确认定金');
  assert.equal(current.department_id, 3);
  assert.equal(current.dept_name, '财务部门');
  assert.equal(current.planned_end_date, '2026-08-20');
  assert.equal(current.overdue, false);
});

test('buildCurrentStage flags overdue planned date', () => {
  const current = buildCurrentStage([mkStage('contract_sign', 'pending', { planned_end_date: '2020-01-01' })]);
  assert.equal(current.overdue, true);
});

test('buildCurrentStage returns null when all completed', () => {
  assert.equal(buildCurrentStage([mkStage('contract_sign', 'completed')]), null);
});

test('listOrders attaches current_stage and keeps progress', async () => {
  const order = { id: 7, order_no: 'ORD-7', status: 'in_progress', planned_delivery_date: '2026-08-30', created_at: '2026-08-01' };
  const stages = [
    mkStage('contract_sign', 'completed', { stage_order: 1 }),
    mkStage('deposit_confirm', 'in_progress', { stage_order: 2, department_id: 3, dept_name: '财务部门', stage_name: '财务确认定金' })
  ];
  const db = fakeDb({ orders: [order], stagesByOrder: new Map([[7, stages]]) });
  await withDb(db, async () => {
    const r = await listOrders({ page: '1', limit: '10' });
    assert.equal(r.status, 200);
    assert.equal(r.body.orders[0].progress, Math.round(1 / 23 * 100));
    assert.equal(r.body.orders[0].current_stage.stage_key, 'deposit_confirm');
    assert.equal(r.body.orders[0].current_stage.dept_name, '财务部门');
  });
});

test('listMyTodos includes ready current stage for responsible role', async () => {
  const order = { id: 7, order_no: 'ORD-7', status: 'pending', planned_delivery_date: '2026-08-30' };
  const stages = [mkStage('contract_sign', 'pending', { stage_order: 1, department_id: 1, dept_name: '销售部门', stage_name: '签订合同' })];
  const sales = { id: 3, name: '销售', role: 'sales', department_id: 1 };
  const db = fakeDb({ orders: [order], stagesByOrder: new Map([[7, stages]]) });
  await withDb(db, async () => {
    const r = await listMyTodos(sales);
    assert.equal(r.body.todos.length, 1);
    assert.equal(r.body.todos[0].order_id, 7);
    assert.equal(r.body.todos[0].category, 'ready');
    assert.equal(r.body.todos[0].stage_name, '签订合同');
  });
});

test('listMyTodos hides stages outside user department', async () => {
  const order = { id: 7, order_no: 'ORD-7', status: 'pending', planned_delivery_date: '2026-08-30' };
  const stages = [mkStage('technical_design', 'pending', { stage_order: 6, department_id: 4, dept_name: '技术部门' })];
  const sales = { id: 3, name: '销售', role: 'sales', department_id: 1 };
  const db = fakeDb({ orders: [order], stagesByOrder: new Map([[7, stages]]) });
  await withDb(db, async () => {
    const r = await listMyTodos(sales);
    assert.equal(r.body.todos.length, 0);
  });
});

test('listMyTodos includes in_progress stage for department', async () => {
  const order = { id: 8, order_no: 'ORD-8', status: 'in_progress', planned_delivery_date: '2026-08-30' };
  const stages = [mkStage('technical_design', 'in_progress', { stage_order: 6, department_id: 4, dept_name: '技术部门', stage_name: '技术设计' })];
  const tech = { id: 6, name: '技术', role: 'production', department_id: 4 };
  const db = fakeDb({ orders: [order], stagesByOrder: new Map([[8, stages]]) });
  await withDb(db, async () => {
    const r = await listMyTodos(tech);
    assert.equal(r.body.todos.length, 1);
    assert.equal(r.body.todos[0].category, 'in_progress');
  });
});

test('listMyTodos ready requires dependencies completed', async () => {
  const finance = { id: 11, name: '财务', role: 'finance', department_id: 3 };
  const order = { id: 9, order_no: 'ORD-9', status: 'pending', planned_delivery_date: '2026-08-30' };
  const blocked = fakeDb({
    orders: [order],
    stagesByOrder: new Map([[9, [
      mkStage('contract_sign', 'pending', { stage_order: 1 }),
      mkStage('deposit_confirm', 'pending', { stage_order: 2, department_id: 3, depends_on: 'contract_sign' })
    ]]])
  });
  await withDb(blocked, async () => {
    const r = await listMyTodos(finance);
    assert.equal(r.body.todos.length, 0);
  });
  const ready = fakeDb({
    orders: [order],
    stagesByOrder: new Map([[9, [
      mkStage('contract_sign', 'completed', { stage_order: 1 }),
      mkStage('deposit_confirm', 'pending', { stage_order: 2, department_id: 3, depends_on: 'contract_sign', stage_name: '财务确认定金' })
    ]]])
  });
  await withDb(ready, async () => {
    const r = await listMyTodos(finance);
    assert.equal(r.body.todos.length, 1);
    assert.equal(r.body.todos[0].category, 'ready');
    assert.equal(r.body.todos[0].stage_name, '财务确认定金');
  });
});

test('admin sees management-only stage todos', async () => {
  const admin = { id: 1, name: '管理员', role: 'admin', department_id: null };
  const order = { id: 10, order_no: 'ORD-10', status: 'in_progress', planned_delivery_date: '2026-08-30' };
  const stages = [mkStage('gm_sign', 'in_progress', { stage_order: 4, department_id: null, dept_name: null, stage_name: '总经理签字' })];
  const db = fakeDb({ orders: [order], stagesByOrder: new Map([[10, stages]]) });
  await withDb(db, async () => {
    const r = await listMyTodos(admin);
    assert.equal(r.body.todos.length, 1);
  });
});
