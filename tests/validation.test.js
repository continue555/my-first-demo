const test = require('node:test');
const assert = require('node:assert');
const {
  cleanText,
  validateDate,
  validateStageDateTime,
  validateOrderInput,
  generateOrderNo
} = require('../services/order-service');

test('cleanText trims and limits length', () => {
  assert.equal(cleanText('  abc  ', 10), 'abc');
  assert.equal(cleanText('abcdef', 3), 'abc');
});

test('validateDate accepts YYYY-MM-DD only', () => {
  assert.equal(validateDate('2026-08-01').ok, true);
  assert.equal(validateDate('2026-8-1').ok, false);
  assert.equal(validateDate('not-a-date').ok, false);
  assert.equal(validateDate(null).value, null);
});

test('validateStageDateTime accepts datetime and date', () => {
  assert.equal(validateStageDateTime('2026-08-01T09:00').ok, true);
  assert.equal(validateStageDateTime('2026-08-01').ok, true);
  assert.equal(validateStageDateTime('2026-08-01 09:00').ok, false);
});

test('validateOrderInput requires delivery date on create', () => {
  const noDate = validateOrderInput({}, true);
  assert.equal(noDate.error, '计划交货日期为必填项');
  const ok = validateOrderInput({ planned_delivery_date: '2026-08-10' }, true);
  assert.equal(ok.data.planned_delivery_date, '2026-08-10');
});

test('generateOrderNo follows expected prefix', () => {
  assert.match(generateOrderNo(), /^ORD-\d{4}-\d{4}-[A-Z0-9]{4}$/);
});
