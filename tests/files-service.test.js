const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const database = require('../database');
const { MAX_ORDER_FILES_BYTES, exceedsOrderFileQuota, saveUploadedFile } = require('../services/files-service');

function fakeDb(getHandler) {
  return {
    prepare(sql) {
      return {
        async get(...params) {
          return getHandler ? getHandler(sql, params) : null;
        },
        async all() {
          return [];
        },
        async run() {
          return { changes: 1, lastInsertRowid: 1 };
        }
      };
    }
  };
}

test('order file quota allows totals under the limit', () => {
  assert.equal(exceedsOrderFileQuota(0, 1024), false);
  assert.equal(exceedsOrderFileQuota(MAX_ORDER_FILES_BYTES - 1, 1), false);
});

test('order file quota rejects totals over the limit', () => {
  assert.equal(exceedsOrderFileQuota(MAX_ORDER_FILES_BYTES, 1), true);
  assert.equal(exceedsOrderFileQuota(MAX_ORDER_FILES_BYTES - 1, 2), true);
});

test('saveUploadedFile returns 404 for missing order and removes temp file', async () => {
  const tmpFile = path.join(os.tmpdir(), `missing-order-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, 'hello');
  const original = database.getDb;
  database.getDb = () => fakeDb(() => null);
  try {
    const r = await saveUploadedFile({
      orderId: 999999,
      user: { id: 1, name: '管理员' },
      file: { path: tmpFile, mimetype: 'text/plain', size: 5, originalname: 'a.txt', filename: 'a.txt' },
      stageKey: null
    });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, '订单不存在');
    assert.equal(fs.existsSync(tmpFile), false);
  } finally {
    database.getDb = original;
  }
});
