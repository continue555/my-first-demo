const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb, logAudit } = require('../database');
const { generateToken, authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// ===== 输入校验 =====
function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/[<>"']/g, '').slice(0, 200);
}

function validatePassword(pwd) {
  if (!pwd || pwd.length < 6) return '密码至少6位';
  return null;
}

// ===== 登录限流 =====
const rateLimitMap = new Map(); // key: username_ip, value: { count, firstTime, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15分钟

function getRateLimitKey(username, ip) {
  return `${username}_${ip}`;
}

function checkRateLimit(username, ip) {
  const key = getRateLimitKey(username, ip);
  const record = rateLimitMap.get(key);
  const now = Date.now();

  if (!record) return null;

  if (record.lockedUntil && now < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - now) / 1000 / 60);
    return `账号已锁定，请${remaining}分钟后重试`;
  }

  if (record.lockedUntil && now >= record.lockedUntil) {
    rateLimitMap.delete(key);
    return null;
  }

  return null;
}

function recordFailedAttempt(username, ip) {
  const key = getRateLimitKey(username, ip);
  const record = rateLimitMap.get(key) || { count: 0, firstTime: Date.now() };
  record.count++;

  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCK_TIME;
  }

  rateLimitMap.set(key, record);
}

function clearRateLimit(username, ip) {
  rateLimitMap.delete(getRateLimitKey(username, ip));
}

// 定期清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap) {
    if (record.lockedUntil && now > record.lockedUntil + 3600000) {
      rateLimitMap.delete(key);
    }
  }
}, 3600000);

async function getChildDeptIds(deptId) {
  if (!deptId) return [];
  const db = getDb();
  const children = await db.prepare('SELECT id FROM departments WHERE parent_id = ?').all(deptId);
  return children.map(c => c.id);
}

// ===== 登录 =====
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  const cleanUsername = sanitize(username);
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  // 检查限流
  const rateLimitMsg = checkRateLimit(cleanUsername, ip);
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
    recordFailedAttempt(cleanUsername, ip);
    await logAudit(null, cleanUsername, '登录失败', 'auth', null, `IP: ${ip}`);
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  clearRateLimit(cleanUsername, ip);
  const childDeptIds = await getChildDeptIds(user.department_id);
  const token = generateToken(user);

  await logAudit(user.id, user.username, '登录成功', 'auth', null, `IP: ${ip}`);

  res.json({
    token,
    user: {
      id: user.id, username: user.username, name: user.name, role: user.role,
      department_id: user.department_id, dept_name: user.dept_name,
      dept_parent_id: user.dept_parent_id, child_dept_ids: childDeptIds
    }
  });
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
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写完整信息' });

  const pwdErr = validatePassword(newPassword);
  if (pwdErr) return res.status(400).json({ error: pwdErr });

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
  const { username, password, name, department_id, role } = req.body;
  if (!username || !password || !name || !role) return res.status(400).json({ error: '请填写完整信息' });

  const cleanUsername = sanitize(username);
  const cleanName = sanitize(name);
  const pwdErr = validatePassword(password);
  if (pwdErr) return res.status(400).json({ error: pwdErr });

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

  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  await logAudit(req.user.id, req.user.name, '删除用户', 'user', parseInt(req.params.id), `用户名: ${user.username}`);
  res.json({ message: '用户已删除' });
});

// 修改用户信息
router.put('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, department_id, role } = req.body;

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
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: '请输入新密码' });

  const pwdErr = validatePassword(newPassword);
  if (pwdErr) return res.status(400).json({ error: pwdErr });

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.params.id);
  await logAudit(req.user.id, req.user.name, '重置密码', 'user', parseInt(req.params.id), `用户名: ${user.username}`);
  res.json({ message: '密码已重置' });
});

module.exports = router;

