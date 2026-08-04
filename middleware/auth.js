const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const { parseCookies } = require('../lib/cookies');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('[FATAL] JWT_SECRET 未设置，请在 .env 中配置'); process.exit(1); }

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      department_id: user.department_id,
      name: user.name,
      ver: Number(user.token_version) || 0
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const cookieToken = parseCookies(req.headers.cookie).token;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (!authHeader) {
    token = cookieToken;
  } else {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  if (!token) return res.status(401).json({ error: '未登录或登录已过期' });
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }

  const db = getDb();
  if (!db) return res.status(500).json({ error: '服务器数据库未就绪' });

  db.prepare('SELECT id, username, name, role, department_id, token_version FROM users WHERE id = ?').get(decoded.id)
    .then(user => {
      if (!user) return res.status(401).json({ error: "账号已被删除，请重新登录" });
      if ((decoded.ver || 0) !== (user.token_version || 0)) {
        return res.status(401).json({ error: "登录已过期，请重新登录" });
      }
      req.user = { ...decoded, ...user };
      next();
    })
    .catch(err => {
      console.error('[Auth] 用户校验失败:', err.message);
      return res.status(500).json({ error: '服务器内部错误' });
    });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '您没有权限执行此操作' });
    next();
  };
}

async function getDepartmentTreeIds(departmentId) {
  const db = getDb();
  const ids = [departmentId];
  const children = await db.prepare('SELECT id FROM departments WHERE parent_id = ?').all(departmentId);
  children.forEach(c => ids.push(c.id));
  return ids;
}

async function getChildDeptIds(departmentId) {
  if (!departmentId) return [];
  const db = getDb();
  const children = await db.prepare('SELECT id FROM departments WHERE parent_id = ?').all(departmentId);
  return children.map(c => c.id);
}

async function bumpTokenVersion(userId) {
  const db = getDb();
  await db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
}

async function revokeSessionToken(token) {
  if (!token) return;
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return;
  }
  await bumpTokenVersion(decoded.id);
}

async function departmentFilter(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'management') return next();
  req.userDeptIds = await getDepartmentTreeIds(req.user.department_id);
  next();
}

module.exports = {
  JWT_SECRET, generateToken, authMiddleware, requireRole, departmentFilter,
  getDepartmentTreeIds, getChildDeptIds, bumpTokenVersion, revokeSessionToken
};
