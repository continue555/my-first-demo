const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const database = require('../database');
function getDb() { return database.getDb(); }
function logAudit(...args) { return database.logAudit(...args); }
const { generateToken, getChildDeptIds, bumpTokenVersion } = require('../middleware/auth');
const sanitize = require('../lib/sanitize');
const { checkRateLimit, recordFailedAttempt, clearRateLimit } = require('../lib/login-rate-limit');
const { parse, registerSchema, changePasswordSchema, resetPasswordSchema, updateUserSchema } = require('../lib/validators');

async function login({ username, password, ip, secure }) {
  if (!username || !password) return { status: 400, body: { error: '请输入用户名和密码' } };

  const cleanUsername = sanitize(username);

  const rateLimitMsg = await checkRateLimit(cleanUsername, ip);
  if (rateLimitMsg) {
    return { status: 429, body: { error: rateLimitMsg } };
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
    return { status: 401, body: { error: '用户名或密码错误' } };
  }

  await clearRateLimit(cleanUsername, ip);
  const childDeptIds = await getChildDeptIds(user.department_id);
  const token = generateToken(user);
  const csrfToken = crypto.randomBytes(16).toString('hex');
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
  };

  await logAudit(user.id, user.username, '登录成功', 'auth', null, `IP: ${ip}`);

  return {
    status: 200,
    cookies: [
      { name: 'token', value: token, options: cookieOptions },
      { name: 'csrf', value: csrfToken, options: { ...cookieOptions, httpOnly: false } }
    ],
    body: {
      csrfToken,
      user: {
        id: user.id, username: user.username, name: user.name, role: user.role,
        department_id: user.department_id, dept_name: user.dept_name,
        dept_parent_id: user.dept_parent_id, child_dept_ids: childDeptIds
      }
    }
  };
}

async function me(userId) {
  const db = getDb();
  const user = await db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.department_id, d.name as dept_name, d.parent_id as dept_parent_id
    FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = ?
  `).get(userId);
  if (!user) return { status: 404, body: { error: '用户不存在' } };
  const childDeptIds = await getChildDeptIds(user.department_id);
  return { status: 200, body: { user: { ...user, child_dept_ids: childDeptIds } } };
}

async function listUsers() {
  const db = getDb();
  const users = await db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.department_id, d.name as dept_name
    FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.id
  `).all();
  return { status: 200, body: { users } };
}

async function changePassword(userId, body) {
  const parsed = parse(changePasswordSchema, body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const { oldPassword, newPassword } = parsed.data;

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!bcrypt.compareSync(oldPassword, user.password)) return { status: 400, body: { error: '原密码不正确' } };
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, userId);
  await bumpTokenVersion(userId);
  return { status: 200, body: { message: '密码修改成功' } };
}

async function register(actor, body) {
  const parsed = parse(registerSchema, body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const { username, password, name, department_id, role } = parsed.data;

  const cleanUsername = sanitize(username);
  const cleanName = sanitize(name);

  const db = getDb();
  const exist = await db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (exist) return { status: 400, body: { error: '用户名已存在' } };

  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('INSERT INTO users (username, password, name, department_id, role) VALUES (?, ?, ?, ?, ?)')
    .run(cleanUsername, hash, cleanName, department_id || null, role);
  await logAudit(actor.id, actor.name, '创建用户', 'user', null, `用户名: ${cleanUsername}, 角色: ${role}`);
  return { status: 201, body: { message: '用户创建成功' } };
}

async function deleteUser(actor, id) {
  if (parseInt(id) === actor.id) return { status: 400, body: { error: '不能删除自己' } };

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return { status: 404, body: { error: '用户不存在' } };

  await db.prepare('UPDATE orders SET created_by = NULL WHERE created_by = ?').run(id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  await logAudit(actor.id, actor.name, '删除用户', 'user', parseInt(id), `用户名: ${user.username}`);
  return { status: 200, body: { message: '用户已删除' } };
}

async function updateUser(actor, id, body) {
  const parsed = parse(updateUserSchema, body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const { name, department_id, role } = parsed.data;

  const cleanName = name ? sanitize(name) : undefined;

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return { status: 404, body: { error: '用户不存在' } };

  await db.prepare('UPDATE users SET name = COALESCE(?, name), department_id = COALESCE(?, department_id), role = COALESCE(?, role) WHERE id = ?')
    .run(cleanName, department_id, role, id);
  await logAudit(actor.id, actor.name, '编辑用户', 'user', parseInt(id), `用户名: ${user.username}`);
  return { status: 200, body: { message: '用户信息已更新' } };
}

async function resetPassword(actor, id, body) {
  const parsed = parse(resetPasswordSchema, body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const { newPassword } = parsed.data;

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return { status: 404, body: { error: '用户不存在' } };

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
  await bumpTokenVersion(parseInt(id));
  await logAudit(actor.id, actor.name, '重置密码', 'user', parseInt(id), `用户名: ${user.username}`);
  return { status: 200, body: { message: '密码已重置' } };
}

module.exports = {
  login, me, listUsers, changePassword, register, deleteUser, updateUser, resetPassword
};
