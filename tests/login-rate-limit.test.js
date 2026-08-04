const test = require('node:test');
const assert = require('node:assert');
const database = require('../database');
const rateLimit = require('../lib/login-rate-limit');

function makeFakeDb(store) {
  return {
    prepare(sql) {
      return {
        async get(...params) {
          if (sql.includes('FROM login_attempts')) return store.get(params[0]) || null;
          return null;
        },
        async run(...params) {
          if (sql.trim().startsWith('DELETE')) {
            store.delete(params[0]);
          } else if (sql.includes('INSERT INTO login_attempts')) {
            const [key, count, firstTime, lockedUntil] = params;
            store.set(key, { attempt_key: key, count, first_time: firstTime, locked_until: lockedUntil });
          }
          return { changes: 1 };
        },
        async all() { return []; }
      };
    }
  };
}

test('rate limit: no record returns null', async () => {
  const store = new Map();
  const original = database.getDb;
  database.getDb = () => makeFakeDb(store);
  try {
    assert.equal(await rateLimit.checkRateLimit('admin', '1.2.3.4'), null);
  } finally {
    database.getDb = original;
  }
});

test('rate limit: 5 failed attempts lock the account', async () => {
  const store = new Map();
  const original = database.getDb;
  database.getDb = () => makeFakeDb(store);
  try {
    for (let i = 0; i < 5; i++) await rateLimit.recordFailedAttempt('admin', '1.2.3.4');
    const msg = await rateLimit.checkRateLimit('admin', '1.2.3.4');
    assert.match(msg, /账号已锁定/);
    const record = store.get(rateLimit.getRateLimitKey('admin', '1.2.3.4'));
    assert.equal(record.count, 5);
    assert.ok(record.locked_until);
  } finally {
    database.getDb = original;
  }
});

test('rate limit: expired lock clears the record', async () => {
  const key = rateLimit.getRateLimitKey('user', '9.9.9.9');
  const store = new Map([[key, {
    attempt_key: key, count: 5, first_time: Date.now() - 3600000, locked_until: Date.now() - 1000
  }]]);
  const original = database.getDb;
  database.getDb = () => makeFakeDb(store);
  try {
    assert.equal(await rateLimit.checkRateLimit('user', '9.9.9.9'), null);
    assert.equal(store.has(key), false);
  } finally {
    database.getDb = original;
  }
});

test('rate limit: clearRateLimit removes record', async () => {
  const key = rateLimit.getRateLimitKey('admin', '1.1.1.1');
  const store = new Map([[key, { attempt_key: key, count: 2, first_time: Date.now(), locked_until: null }]]);
  const original = database.getDb;
  database.getDb = () => makeFakeDb(store);
  try {
    await rateLimit.clearRateLimit('admin', '1.1.1.1');
    assert.equal(store.has(key), false);
  } finally {
    database.getDb = original;
  }
});
