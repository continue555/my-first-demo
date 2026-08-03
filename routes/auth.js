const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, logAudit } = require('../database');
const { generateToken, authMiddleware, requireRole, getChildDeptIds } = require('../middleware/auth');
const sanitize = require('../lib/sanitize');
const { parse, registerSchema, changePasswordSchema, resetPasswordSchema, updateUserSchema } = require('../lib/validators');
const crypto = require('crypto');

const router = express.Router();

// ===== 登录限流 =====
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15分钟

function getRateLimitKey(username, ip) {
  return `${username}_${ip}`;
}

async function checkRateLimit(username, ip) {
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
  await db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(getRateLimitKey(username, ip));
}

setInterval(async () => {
  try {
    const db = getDb();
    const now = Date.now();
    await db.prepare('DELETE FROM login_attempts WHERE first_time < ? OR (locked_until IS NOT NULL AND locked_until < ?)')
      .run(now - 24 * 60 * 60 * 1000, now - 60 * 60 * 1000);
  } catch {}
}, 60 * 60 * 1000);

// ===== 登录 =====
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  const cleanUsername = sanitize(username);
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  // 检查限流
  const rateLimitMsg = await checkRateLimit(cleanUsername, ip);
  if (rateLimitMsg) {
    return res.status(429).json({ error: rateLimitMsg });
  }

  const db = getDb();
  const user = await db.prepare(`
    SELECT u.*, d.name as dept_name, d.parent_id as dept_parent_id
    FROM users u LEFT JOIN departments d ON u.department_id = d.id
    WHERE u.username = ?
  `).get(cleanUsername);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    await recordFailedAttempt(cleanUsername, ip);
    await logAudit(null, cleanUsername, '登录失败', 'auth', null, `IP: ${ip}`);
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  await clearRateLimit(cleanUsername, ip);
  const childDeptIds = await getChildDeptIds(user.department_id);
  const token = generateToken(user);
  const csrfToken = crypto.randomBytes(16).toString('hex');
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
  };
  res.cookie('token', token, cookieOptions);
  res.cookie('csrf', csrfToken, { ...cookieOptions, httpOnly: false });

  await logAudit(user.id, user.username, '登录成功', 'auth', null, `IP: ${ip}`);

  res.json({
    csrfToken,
    user: {
      id: user.id, username: user.username, name: user.name, role: user.role,
      department_id: user.department_id, dept_name: user.dept_name,
      dept_parent_id: user.dept_parent_id, child_dept_ids: childDeptIds
    }
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.clearCookie('csrf', { path: '/' });
  res.json({ message: '已退出登录' });
});

router.get('/me', authMiddleware, async (req, res) => {
  const db = getDb();
  const user = await db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.department_id, d.name as dept_name, d.parent_id as dept_parent_id
    FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = ?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const childDeptIds = await getChildDeptIds(user.department_id);
  res.json({ user: { ...user, child_dept_ids: childDeptIds } });
});

router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const db = getDb();
  const users = await db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.department_id, d.name as dept_name
    FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.id
  `).all();
  res.json({ users });
});

router.put('/change-password', authMiddleware, async (req, res) => {
  const parsed = parse(changePasswordSchema, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { oldPassword, newPassword } = parsed.data;

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password)) return res.status(400).json({ error: '原密码不正确' });
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ message: '密码修改成功' });
});

// === 用户管理（管理员） ===

// 新增用户
router.post('/register', authMiddleware, requireRole('admin'), async (req, res) => {
  const parsed = parse(registerSchema, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { username, password, name, department_id, role } = parsed.data;

  const cleanUsername = sanitize(username);
  const cleanName = sanitize(name);

  const db = getDb();
  const exist = await db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (exist) return res.status(400).json({ error: '用户名已存在' });

  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('INSERT INTO users (username, password, name, department_id, role) VALUES (?, ?, ?, ?, ?)')
    .run(cleanUsername, hash, cleanName, department_id || null, role);
  await logAudit(req.user.id, req.user.name, '创建用户', 'user', null, `用户名: ${cleanUsername}, 角色: ${role}`);
  res.status(201).json({ message: '用户创建成功' });
});

// 删除用户
router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: '不能删除自己' });

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 解除订单创建人引用，避免外键报错
  await db.prepare('UPDATE orders SET created_by = NULL WHERE created_by = ?').run(req.params.id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  await logAudit(req.user.id, req.user.name, '删除用户', 'user', parseInt(req.params.id), `用户名: ${user.username}`);
  res.json({ message: '用户已删除' });
});

// 修改用户信息
router.put('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const parsed = parse(updateUserSchema, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, department_id, role } = parsed.data;

  const cleanName = name ? sanitize(name) : undefined;

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  await db.prepare('UPDATE users SET name = COALESCE(?, name), department_id = COALESCE(?, department_id), role = COALESCE(?, role) WHERE id = ?')
    .run(cleanName, department_id, role, req.params.id);
  await logAudit(req.user.id, req.user.name, '编辑用户', 'user', parseInt(req.params.id), `用户名: ${user.username}`);
  res.json({ message: '用户信息已更新' });
});

// 管理员重置用户密码
router.put('/users/:id/reset-password', authMiddleware, requireRole('admin'), async (req, res) => {
  const parsed = parse(resetPasswordSchema, req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { newPassword } = parsed.data;

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.params.id);
  await logAudit(req.user.id, req.user.name, '重置密码', 'user', parseInt(req.params.id), `用户名: ${user.username}`);
  res.json({ message: '密码已重置' });
});

module.exports = router;

