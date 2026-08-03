const test = require('node:test');
const assert = require('node:assert');
const sanitize = require('../lib/sanitize');

test('strips html special characters', () => {
  assert.equal(sanitize('<script>alert("x")</script>'), 'scriptalert(x)/script');
});

test('truncates to 200 characters', () => {
  assert.equal(sanitize('a'.repeat(300)).length, 200);
});

test('handles empty values', () => {
  assert.equal(sanitize(null), '');
  assert.equal(sanitize(undefined), '');
});
