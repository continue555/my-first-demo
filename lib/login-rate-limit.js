const database = require('../database');

const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15分钟

function getRateLimitKey(username, ip) {
  return `${username}_${ip}`;
}

async function checkRateLimit(username, ip) {
  const db = database.getDb();
  const key = getRateLimitKey(username, ip);
  const record = await db.prepare('SELECT * FROM login_attempts WHERE attempt_key = ?').get(key);
  const now = Date.now();

  if (!record) return null;

  if (record.locked_until && now < Number(record.locked_until)) {
    const remaining = Math.ceil((Number(record.locked_until) - now) / 1000 / 60);
    return `账号已锁定，请${remaining}分钟后重试`;
  }

  if (record.locked_until && now >= Number(record.locked_until)) {
    await db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
    return null;
  }

  return null;
}

async function recordFailedAttempt(username, ip) {
  const db = database.getDb();
  const key = getRateLimitKey(username, ip);
  const now = Date.now();
  const record = await db.prepare('SELECT * FROM login_attempts WHERE attempt_key = ?').get(key);
  const count = (record && now - Number(record.first_time) < 24 * 60 * 60 * 1000) ? Number(record.count) + 1 : 1;
  const firstTime = record && now - Number(record.first_time) < 24 * 60 * 60 * 1000 ? Number(record.first_time) : now;
  let lockedUntil = null;

  if (count >= MAX_ATTEMPTS) {
    lockedUntil = now + LOCK_TIME;
  }

  await db.prepare(`
    INSERT INTO login_attempts (attempt_key, count, first_time, locked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (attempt_key) DO UPDATE SET
      count = EXCLUDED.count,
      first_time = EXCLUDED.first_time,
      locked_until = EXCLUDED.locked_until
  `).run(key, count, firstTime, lockedUntil);
}

async function clearRateLimit(username, ip) {
  const db = database.getDb();
  await db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(getRateLimitKey(username, ip));
}

const cleanupTimer = setInterval(async () => {
  try {
    const db = database.getDb();
    const now = Date.now();
    await db.prepare('DELETE FROM login_attempts WHERE first_time < ? OR (locked_until IS NOT NULL AND locked_until < ?)')
      .run(now - 24 * 60 * 60 * 1000, now - 60 * 60 * 1000);
  } catch {}
}, 60 * 60 * 1000);
cleanupTimer.unref();

module.exports = {
  MAX_ATTEMPTS,
  LOCK_TIME,
  getRateLimitKey,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit
};
