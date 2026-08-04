const test = require('node:test');
const assert = require('node:assert');
const { MAX_ORDER_FILES_BYTES, exceedsOrderFileQuota } = require('../services/files-service');

test('order file quota allows totals under the limit', () => {
  assert.equal(exceedsOrderFileQuota(0, 1024), false);
  assert.equal(exceedsOrderFileQuota(MAX_ORDER_FILES_BYTES - 1, 1), false);
});

test('order file quota rejects totals over the limit', () => {
  assert.equal(exceedsOrderFileQuota(MAX_ORDER_FILES_BYTES, 1), true);
  assert.equal(exceedsOrderFileQuota(MAX_ORDER_FILES_BYTES - 1, 2), true);
});
