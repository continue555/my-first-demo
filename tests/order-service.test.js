const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const { validateStageUpdate, createOrder, updateStage, updateStageTime } = require('../services/order-service');

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

test('updateStage rejects duplicate completion', async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), status: 'completed' }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'purchase_frame', { status: 'completed' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('不能重复完成'));
  } finally {
    database.getDb = original;
  }
});

test('updateStage rejects rollback of completed stage', async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), status: 'completed' }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'purchase_frame', { status: 'pending' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('不能回退状态'));
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
      order_no: 'ORD-X', planned_delivery_date: '2026-08-10'
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '订单编号已存在');
  } finally {
    database.getDb = original;
  }
});

function notificationFakeDb({ stage, depsStatuses, allStatuses }) {
  const inserts = [];
  return {
    inserts,
    prepare(sql) {
      return {
        async get(...params) {
          if (sql.includes('FROM orders') && !sql.includes('status')) return orderRow;
          if (sql.includes('FROM process_stages') && sql.includes('stage_key = ?')) return stage;
          return null;
        },
        async all(...params) {
          if (sql.includes('SELECT status FROM process_stages') && sql.includes('stage_key IN')) return depsStatuses;
          if (sql.includes('SELECT status FROM process_stages')) return allStatuses;
          return [];
        },
        async run(...params) {
          if (sql.includes('INSERT INTO notifications')) {
            inserts.push(params);
            return { changes: 1, lastInsertRowid: 99 };
          }
          return { changes: 1, lastInsertRowid: 1 };
        }
      };
    }
  };
}

function withNoopAudit(fn) {
  const original = database.logAudit;
  database.logAudit = async () => {};
  return async () => {
    try {
      await fn();
    } finally {
      database.logAudit = original;
    }
  };
}

const notAllDone = [
  { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
  { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
  { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
  { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
  { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
  { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
  { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
  { status: 'pending' }
];

test('no notification until all multi-dependencies completed', withNoopAudit(async () => {
  const fake = notificationFakeDb({
    stage: { id: 10, stage_key: 'frame_follow_up', stage_name: '机架采购跟进', status: 'in_progress', department_id: 12 },
    depsStatuses: [
      { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
      { status: 'completed' }, { status: 'pending' }
    ],
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'frame_follow_up', { status: 'completed' });
    assert.equal(r.status, 200);
    assert.equal(fake.inserts.length, 0);
  } finally {
    database.getDb = original;
  }
}));

test('notification fires when all dependencies completed', withNoopAudit(async () => {
  const fake = notificationFakeDb({
    stage: { id: 10, stage_key: 'frame_follow_up', stage_name: '机架采购跟进', status: 'in_progress', department_id: 12 },
    depsStatuses: [
      { status: 'completed' }, { status: 'completed' }, { status: 'completed' },
      { status: 'completed' }, { status: 'completed' }
    ],
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'frame_follow_up', { status: 'completed' });
    assert.equal(r.status, 200);
    assert.equal(fake.inserts.length, 1);
    assert.equal(fake.inserts[0][2], 6);
    assert.ok(fake.inserts[0][1].includes('物料进仓'));
  } finally {
    database.getDb = original;
  }
}));

test('parallel next stages aggregated per department', withNoopAudit(async () => {
  const fake = notificationFakeDb({
    stage: { id: 8, stage_key: 'purchase_plan', stage_name: '采购计划制定', status: 'in_progress', department_id: 5 },
    depsStatuses: [],
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'purchase_plan', { status: 'completed' });
    assert.equal(r.status, 200);
    assert.equal(fake.inserts.length, 2);
    const dept5 = fake.inserts.find(i => i[2] === 5);
    const dept11 = fake.inserts.find(i => i[2] === 11);
    assert.ok(dept5 && dept5[1].includes('机架采购') && dept5[1].includes('外罩采购'));
    assert.ok(dept11 && dept11[1].includes('模具设计与采购'));
  } finally {
    database.getDb = original;
  }
}));

test('null-department stage notifies management role', withNoopAudit(async () => {
  const fake = notificationFakeDb({
    stage: { id: 7, stage_key: 'manufacturing_approval', stage_name: '制造审批', status: 'in_progress', department_id: 10 },
    depsStatuses: [],
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'manufacturing_approval', { status: 'completed' });
    assert.equal(r.status, 200);
    assert.equal(fake.inserts.length, 1);
    assert.equal(fake.inserts[0][2], 'management');
    assert.equal(fake.inserts[0].length, 4);
    assert.ok(fake.inserts[0][1].includes('总经理签字'));
  } finally {
    database.getDb = original;
  }
}));

function recordingDb({ stageFor, plannedRows, allStatuses, depsStatuses }) {
  const runs = [];
  return {
    runs,
    prepare(sql) {
      return {
        async get(...params) {
          if (sql.includes('FROM orders')) return orderRow;
          if (sql.includes('FROM process_stages') && sql.includes('stage_key = ?')) return stageFor ? stageFor(params[1]) : null;
          return null;
        },
        async all(...params) {
          if (sql.includes('SELECT planned_end_date FROM process_stages') && sql.includes('stage_key IN')) return plannedRows || [];
          if (sql.includes('SELECT status FROM process_stages') && sql.includes('stage_key IN')) return depsStatuses || [];
          if (sql.includes('SELECT status FROM process_stages')) return allStatuses || [];
          return [];
        },
        async run(...params) {
          runs.push({ sql, params });
          return { changes: 1, lastInsertRowid: 1 };
        }
      };
    }
  };
}

const genericStage = key => ({
  id: 10, stage_key: key, status: 'in_progress', department_id: 5,
  start_date: '2026-08-01', planned_end_date: '2026-08-01'
});

test('purchase planned date syncs follow-up and material_in', async () => {
  const fake = recordingDb({
    stageFor: genericStage,
    plannedRows: [
      { planned_end_date: '2026-08-10' }, { planned_end_date: '2026-08-12' },
      { planned_end_date: null }, { planned_end_date: null }, { planned_end_date: null }
    ]
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(admin, 1, 'purchase_frame', { start_date: '2026-08-01', planned_end_date: '2026-08-10' });
    assert.equal(r.status, 200);
    const followUp = fake.runs.find(x => x.sql.includes('stage_key = ?') && x.params.includes('frame_follow_up'));
    assert.ok(followUp && followUp.params[0] === '2026-08-10');
    const materialIn = fake.runs.find(x => x.sql.includes("stage_key = 'material_in'"));
    assert.ok(materialIn && materialIn.params[0] === '2026-08-12');
  } finally {
    database.getDb = original;
  }
});

test('follow-up time settings are locked', async () => {
  const fake = recordingDb({ stageFor: genericStage });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(admin, 1, 'frame_follow_up', { start_date: '2026-08-05', planned_end_date: '2026-08-10' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('自动生成'));
  } finally {
    database.getDb = original;
  }
});

test('material_in time settings are locked', async () => {
  const fake = recordingDb({ stageFor: genericStage });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(admin, 1, 'material_in', { start_date: '2026-08-05', planned_end_date: '2026-08-10' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('自动生成'));
  } finally {
    database.getDb = original;
  }
});

test('delivery_payment rejects start date but accepts planned', async () => {
  const fake = recordingDb({ stageFor: genericStage });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const rejected = await updateStageTime(admin, 1, 'delivery_payment', { start_date: '2026-08-05', planned_end_date: '2026-08-10' });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.error.includes('不需要开始时间'));

    const accepted = await updateStageTime(admin, 1, 'delivery_payment', { planned_end_date: '2026-08-10' });
    assert.equal(accepted.status, 200);
  } finally {
    database.getDb = original;
  }
});

test('delivery_payment requires planned date before start', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb({
    get: sql => (sql.includes('FROM orders')
      ? orderRow
      : { id: 10, department_id: 3, stage_key: 'delivery_payment', status: 'pending', start_date: null, planned_end_date: null })
  });
  try {
    const r = await updateStage(admin, 1, 'delivery_payment', { status: 'in_progress' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '请先设置计划完成日期');
  } finally {
    database.getDb = original;
  }
});

test('follow-up keeps procurement message when planned date missing', async () => {
  const original = database.getDb;
  database.getDb = () => fakeDb({
    get: sql => (sql.includes('FROM orders')
      ? orderRow
      : { id: 10, department_id: 12, stage_key: 'frame_follow_up', status: 'pending', start_date: null, planned_end_date: null })
  });
  try {
    const r = await updateStage(admin, 1, 'frame_follow_up', { status: 'in_progress' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, '计划完成时间未生成，请先确认采购计划到货时间');
  } finally {
    database.getDb = original;
  }
});

test('delivery_payment completion keeps start null', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: genericStage,
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'delivery_payment', { status: 'completed' });
    assert.equal(r.status, 200);
    const stageUpdate = fake.runs.find(x => x.sql.includes('actual_end_date = ?') && x.params.includes('delivery_payment'));
    assert.ok(stageUpdate && stageUpdate.params[1] === null);
  } finally {
    database.getDb = original;
  }
}));

test('delivery_payment planned date locked for non-admin after set', async () => {
  const finance = { id: 11, name: '财务', role: 'finance', department_id: 3 };
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), department_id: 3, planned_end_date: '2026-08-10' })
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(finance, 1, 'delivery_payment', { planned_end_date: '2026-08-12' });
    assert.equal(r.status, 403);
    assert.ok(r.body.error.includes('仅管理员和总经理可修改'));
  } finally {
    database.getDb = original;
  }
});

test('delivery_payment planned date settable when empty', async () => {
  const finance = { id: 11, name: '财务', role: 'finance', department_id: 3 };
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), department_id: 3, start_date: null, planned_end_date: null })
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(finance, 1, 'delivery_payment', { planned_end_date: '2026-08-12' });
    assert.equal(r.status, 200);
  } finally {
    database.getDb = original;
  }
});

test('follow-up completion backfills purchase actual arrival', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: genericStage,
    allStatuses: notAllDone,
    depsStatuses: Array.from({ length: 5 }, () => ({ status: 'completed' }))
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'frame_follow_up', { status: 'completed' });
    assert.equal(r.status, 200);
    const backfill = fake.runs.find(x => x.sql.includes('actual_end_date IS NULL'));
    assert.ok(backfill && backfill.params.includes('purchase_frame'));
    const stageUpdate = fake.runs.find(x => x.sql.includes('actual_end_date = ?') && x.params.includes('frame_follow_up'));
    assert.ok(stageUpdate && stageUpdate.params[1] === null);
  } finally {
    database.getDb = original;
  }
}));

test('purchase completion syncs follow-up planned date', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: key => ({
      id: 10, stage_key: key, status: 'in_progress', department_id: 5,
      start_date: '2026-08-01', planned_end_date: '2026-08-10'
    }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'purchase_frame', { status: 'completed' });
    assert.equal(r.status, 200);
    const sync = fake.runs.find(x => x.sql.includes('stage_key = ?') && x.params.includes('frame_follow_up'));
    assert.ok(sync && sync.params[0] === '2026-08-10');
  } finally {
    database.getDb = original;
  }
}));

test('follow-up completion does not set material_in start', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: genericStage,
    allStatuses: notAllDone,
    depsStatuses: Array.from({ length: 5 }, () => ({ status: 'completed' }))
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'frame_follow_up', { status: 'completed' });
    assert.equal(r.status, 200);
    assert.equal(fake.runs.some(x => x.sql.includes("stage_key = 'material_in'")), false);
  } finally {
    database.getDb = original;
  }
}));

test('material_in completion backfills all purchase actual arrival', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: genericStage,
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'material_in', { status: 'completed' });
    assert.equal(r.status, 200);
    const backfill = fake.runs.find(x => x.sql.includes('GREATEST(COALESCE(actual_end_date'));
    assert.ok(backfill);
    for (const key of ['purchase_frame', 'purchase_mold_frame', 'purchase_electrical', 'purchase_cover', 'mold_design_purchase']) {
      assert.ok(backfill.params.includes(key));
    }
  } finally {
    database.getDb = original;
  }
}));

test('shipping completion backfills actual delivery date', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), department_id: 9 }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'shipping', { status: 'completed' });
    assert.equal(r.status, 200);
    const orderUpdate = fake.runs.find(x => x.sql.includes('actual_delivery_date') && x.sql.includes('UPDATE orders'));
    assert.ok(orderUpdate);
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.equal(orderUpdate.params[0], today);
  } finally {
    database.getDb = original;
  }
}));

test('order completes only when all stages completed', withNoopAudit(async () => {
  const allCompleted = Array.from({ length: 23 }, () => ({ status: 'completed' }));
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), department_id: 9 }),
    allStatuses: allCompleted
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'shipping', { status: 'completed' });
    assert.equal(r.status, 200);
    const orderDone = fake.runs.find(x => x.sql.includes("status = 'completed'") && x.sql.includes('UPDATE orders'));
    assert.ok(orderDone);
    assert.ok(orderDone.params[0]);
    assert.ok(orderDone.sql.includes('SELECT COUNT(*) FROM process_stages'));
  } finally {
    database.getDb = original;
  }
}));

test('start blocked until dependency completed', async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), department_id: 2, status: 'pending' }),
    depsStatuses: [{ status: 'pending' }]
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'deposit_confirm', { status: 'in_progress' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('尚未完成'));
  } finally {
    database.getDb = original;
  }
});

test('start overwrites suggested start date with click time', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), status: 'pending', start_date: '2026-08-17' }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'contract_sign', { status: 'in_progress' });
    assert.equal(r.status, 200);
    const run = fake.runs.find(x => x.sql.includes('status = ?') && x.params.includes('in_progress'));
    assert.ok(run);
    const clickTime = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
    assert.equal(run.params[1], clickTime);
    assert.ok(run.sql.includes('start_date = ?') && !run.sql.includes('COALESCE(start_date'));
  } finally {
    database.getDb = original;
  }
}));

test('completion auto-fills next stage start from actual date', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), department_id: 1 }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'contract_sign', { status: 'completed' });
    assert.equal(r.status, 200);
    const nextRun = fake.runs.find(x => x.sql.includes('start_date IS NULL') && x.params.includes('deposit_confirm'));
    assert.ok(nextRun);
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.equal(nextRun.params[0], today);
    assert.ok(!fake.runs.some(x => x.sql.includes('start_date IS NULL') && x.params.includes('frame_follow_up')));
  } finally {
    database.getDb = original;
  }
}));

test('purchase stage accepts manual order date', async () => {
  const fake = recordingDb({ stageFor: genericStage });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(admin, 1, 'purchase_frame', { order_date: '2026-08-07' });
    assert.equal(r.status, 200);
    const run = fake.runs.find(x => x.sql.includes('order_date'));
    assert.ok(run);
    assert.equal(run.params[2], '2026-08-07');
  } finally {
    database.getDb = original;
  }
});

test('purchase stage clears order date when explicitly null', async () => {
  const fake = recordingDb({ stageFor: genericStage });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(admin, 1, 'purchase_frame', { order_date: null });
    assert.equal(r.status, 200);
    const run = fake.runs.find(x => x.sql.includes('order_date'));
    assert.ok(run);
    assert.ok(run.sql.includes('order_date = ?'));
    assert.ok(!run.sql.includes('COALESCE(?, order_date)'));
    assert.equal(run.params[2], null);
  } finally {
    database.getDb = original;
  }
});

test('non-purchase stage rejects manual order date', async () => {
  const fake = recordingDb({ stageFor: genericStage });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStageTime(admin, 1, 'contract_sign', { order_date: '2026-08-07' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('采购'));
  } finally {
    database.getDb = original;
  }
});

test('mold design stage can start without planned end date', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: key => key === 'purchase_plan'
      ? { ...genericStage(key), status: 'completed' }
      : { ...genericStage(key), status: 'pending', start_date: null, planned_end_date: null },
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'mold_design_purchase', { status: 'in_progress' });
    assert.equal(r.status, 200);
  } finally {
    database.getDb = original;
  }
}));

test('mold design purchase cannot complete without order date and planned arrival', async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), status: 'in_progress', start_date: '2026-08-01', planned_end_date: null, order_date: null }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'mold_design_purchase', { status: 'completed' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('下单时间和计划到货'));
  } finally {
    database.getDb = original;
  }
});

test('mold design purchase completes when order date and planned arrival set', withNoopAudit(async () => {
  const fake = recordingDb({
    stageFor: key => ({ ...genericStage(key), status: 'in_progress', start_date: '2026-08-01', planned_end_date: '2026-08-10', order_date: '2026-08-02' }),
    allStatuses: notAllDone
  });
  const original = database.getDb;
  database.getDb = () => fake;
  try {
    const r = await updateStage(admin, 1, 'mold_design_purchase', { status: 'completed' });
    assert.equal(r.status, 200);
  } finally {
    database.getDb = original;
  }
}));
