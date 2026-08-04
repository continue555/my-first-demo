const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const { validateStageUpdate, createOrder, updateStage } = require('../services/order-service');

function fakeDb(handlers = {}) {
  return {
    prepare(sql) {
      return {
        async get(...params) {
          if (handlers.get) return handlers.get(sql, params);
          return null;
        },
        async all(...params) {
          if (handlers.all) return handlers.all(sql, params);
          return [];
        },
        async run(...params) {
          if (handlers.run) return handlers.run(sql, params);
          return { lastInsertRowid: 1, changes: 1 };
        }
      };
    }
  };
}

const admin = { id: 1, name: '管理员', role: 'admin', department_id: null };
const orderRow = { id: 1, order_no: 'ORD-1', status: 'pending' };

test('validateStageUpdate rejects bad notes and status', () => {
  assert.equal(validateStageUpdate({ status: 'in_progress', notes: { a: 1 } }).error, '备注格式不正确');
  assert.equal(validateStageUpdate({ status: 'bogus' }).error, '不支持的流程状态');
  assert.equal(validateStageUpdate({ status: 'completed' }), null);
});

test('updateStage returns 404 for missing order', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb({ get: () => null });
  try {
    const r = await updateStage(admin, 99, 'contract_sign', { status: 'in_progress' });
    assert.equal(r.status, 404);
  } finally {
    database.getDb = original;
  }
});

test('updateStage returns 404 for missing stage', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb({
    get: sql => (sql.includes('FROM orders') ? orderRow : null)
  });
  try {
    const r = await updateStage(admin, 1, 'missing_key', { status: 'in_progress' });
    assert.equal(r.status, 404);
  } finally {
    database.getDb = original;
  }
});

test('updateStage denies out-of-department sales user', async () => {
  const sales = { id: 3, name: '销售', role: 'sales', department_id: 1 };
  const original = database.getDb;
  database.getDb = () => fakeDb({
    get: sql => (sql.includes('FROM orders') ? orderRow : { id: 10, department_id: 4, status: 'pending' })
  });
  try {
    const r = await updateStage(sales, 1, 'technical_design', { status: 'in_progress' });
    assert.equal(r.status, 403);
  } finally {
    database.getDb = original;
  }
});

test('updateStage blocks pending to completed', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb({
    get: sql => (sql.includes('FROM orders') ? orderRow : { id: 10, department_id: 1, status: 'pending' })
  });
  try {
    const r = await updateStage(admin, 1, 'contract_sign', { status: 'completed' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '该流程节点尚未开始，无法直接完成');
  } finally {
    database.getDb = original;
  }
});

test('updateStage requires time before start', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb({
    get: sql => (sql.includes('FROM orders') ? orderRow : { id: 10, department_id: 1, status: 'pending', start_date: null, planned_end_date: null })
  });
  try {
    const r = await updateStage(admin, 1, 'contract_sign', { status: 'in_progress' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '请先设置开始时间和计划完成时间');
  } finally {
    database.getDb = original;
  }
});

test('createOrder returns 400 on unique violation', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb({
    get: () => null,
    run: () => {
      const err = new Error('duplicate key');
      err.code = '23505';
      throw err;
    }
  });
  try {
    const r = await createOrder(admin, {
      order_no: 'ORD-X', customer_name: 'A', project_name: 'B', planned_delivery_date: '2026-08-10'
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '订单编号已存在');
  } finally {
    database.getDb = original;
  }
});
