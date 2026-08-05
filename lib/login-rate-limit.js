const database = require('../database');

// 防滥用策略：锁定 IP 而不是账号，避免任何人通过连续输错把某个账号锁死。
// 同一 IP 累计 20 次失败后锁定 30 分钟；账号+IP 计数仅用于统计，不触发锁定。
const IP_ATTEMPTS = 20;
const IP_LOCK_TIME = 30 * 60 * 1000;

function getRateLimitKey(username, ip) {
  return `${username}_${ip}`;
}

function getIpKey(ip) {
  return `ip:${ip}`;
}

async function checkRateLimit(username, ip) {
  const db = database.getDb();
  const now = Date.now();

  for (const key of [getIpKey(ip), getRateLimitKey(username, ip)]) {
    const record = await db.prepare('SELECT * FROM login_attempts WHERE attempt_key = ?').get(key);
    if (!record) continue;

    if (record.locked_until && now < Number(record.locked_until)) {
      const remaining = Math.ceil((Number(record.locked_until) - now) / 1000 / 60);
      return `尝试过于频繁，请${remaining}分钟后重试`;
    }

    if (record.locked_until && now >= Number(record.locked_until)) {
      await db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
    }
  }

  return null;
}

async function recordFailedAttempt(username, ip) {
  const db = database.getDb();
  const now = Date.now();

  const entries = [
    { key: getIpKey(ip), lockAfter: IP_ATTEMPTS },
    { key: getRateLimitKey(username, ip), lockAfter: null }
  ];

  for (const entry of entries) {
    const record = await db.prepare('SELECT * FROM login_attempts WHERE attempt_key = ?').get(entry.key);
    const fresh = record && now - Number(record.first_time) < 24 * 60 * 60 * 1000;
    const count = fresh ? Number(record.count) + 1 : 1;
    const firstTime = fresh ? Number(record.first_time) : now;
    const lockedUntil = entry.lockAfter && count >= entry.lockAfter ? now + IP_LOCK_TIME : null;

    await db.prepare(`
      INSERT INTO login_attempts (attempt_key, count, first_time, locked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (attempt_key) DO UPDATE SET
        count = EXCLUDED.count,
        first_time = EXCLUDED.first_time,
        locked_until = EXCLUDED.locked_until
    `).run(entry.key, count, firstTime, lockedUntil);
  }
}

async function clearRateLimit(username, ip) {
  const db = database.getDb();
  await db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(getIpKey(ip));
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
  IP_ATTEMPTS,
  IP_LOCK_TIME,
  getRateLimitKey,
  getIpKey,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit
};
