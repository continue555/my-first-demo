const test = require('node:test');
const assert = require('node:assert');
const { canOperateStage } = require('../lib/stage-permissions');

test('admin and management can operate any stage', async () => {
  assert.equal(await canOperateStage({ role: 'admin' }, { department_id: 9 }), true);
  assert.equal(await canOperateStage({ role: 'management' }, { department_id: 9 }), true);
});

test('sales can only operate sales stages', async () => {
  assert.equal(await canOperateStage({ role: 'sales', department_id: 1 }, { department_id: 1 }), true);
  assert.equal(await canOperateStage({ role: 'sales', department_id: 1 }, { department_id: 5 }), false);
});

test('finance can only operate finance stages', async () => {
  assert.equal(await canOperateStage({ role: 'finance', department_id: 3 }, { department_id: 3 }), true);
  assert.equal(await canOperateStage({ role: 'finance', department_id: 3 }, { department_id: 1 }), false);
});

test('mold and material follow roles are limited to own department', async () => {
  assert.equal(await canOperateStage({ role: 'mold', department_id: 11 }, { department_id: 11 }), true);
  assert.equal(await canOperateStage({ role: 'mold', department_id: 11 }, { department_id: 5 }), false);
  assert.equal(await canOperateStage({ role: 'material_follow', department_id: 12 }, { department_id: 12 }), true);
});
