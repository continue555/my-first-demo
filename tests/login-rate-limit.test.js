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
            const [key, now, , , , , lockAfter] = params;
            const state = rateLimit.nextAttemptState(store.get(key) || null, now, lockAfter);
            store.set(key, { attempt_key: key, count: state.count, first_time: state.firstTime, locked_until: state.lockedUntil });
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

test('rate limit: 5 failed attempts do not lock the account', async () => {
  const store = new Map();
  const original = database.getDb;
  database.getDb = () => makeFakeDb(store);
  try {
    for (let i = 0; i < 5; i++) await rateLimit.recordFailedAttempt('admin', '1.2.3.4');
    const msg = await rateLimit.checkRateLimit('admin', '1.2.3.4');
    assert.equal(msg, null);
  } finally {
    database.getDb = original;
  }
});

test('rate limit: 20 failed attempts lock the ip', async () => {
  const store = new Map();
  const original = database.getDb;
  database.getDb = () => makeFakeDb(store);
  try {
    for (let i = 0; i < 20; i++) await rateLimit.recordFailedAttempt('admin', '1.2.3.4');
    const msg = await rateLimit.checkRateLimit('admin', '1.2.3.4');
    assert.match(msg, /尝试过于频繁/);
    const ipRecord = store.get(rateLimit.getIpKey('1.2.3.4'));
    assert.equal(ipRecord.count, 20);
    assert.ok(ipRecord.locked_until);
    const otherUser = await rateLimit.checkRateLimit('jishu1', '1.2.3.4');
    assert.match(otherUser, /尝试过于频繁/);
  } finally {
    database.getDb = original;
  }
});

test('rate limit: expired ip lock clears the record', async () => {
  const key = rateLimit.getIpKey('9.9.9.9');
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

test('rate limit: clearRateLimit removes ip and account records', async () => {
  const ipKey = rateLimit.getIpKey('1.1.1.1');
  const userKey = rateLimit.getRateLimitKey('admin', '1.1.1.1');
  const store = new Map([
    [ipKey, { attempt_key: ipKey, count: 2, first_time: Date.now(), locked_until: null }],
    [userKey, { attempt_key: userKey, count: 2, first_time: Date.now(), locked_until: null }]
  ]);
  const original = database.getDb;
  database.getDb = () => makeFakeDb(store);
  try {
    await rateLimit.clearRateLimit('admin', '1.1.1.1');
    assert.equal(store.has(ipKey), false);
    assert.equal(store.has(userKey), false);
  } finally {
    database.getDb = original;
  }
});
