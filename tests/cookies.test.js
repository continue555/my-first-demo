const test = require('node:test');
const assert = require('node:assert');
const { parseCookies } = require('../lib/cookies');

test('parseCookies parses normal cookies', () => {
  assert.deepEqual(parseCookies('a=1; b=two'), { a: '1', b: 'two' });
});

test('parseCookies tolerates malformed percent encoding', () => {
  assert.deepEqual(parseCookies('token=%zz; csrf=abc'), { csrf: 'abc' });
  assert.deepEqual(parseCookies('bad=%'), {});
});
