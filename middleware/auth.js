const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('[FATAL] JWT_SECRET 未设置，请在 .env 中配置'); process.exit(1); }

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, department_id: user.department_id, name: user.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    try {
      const db = getDb();
      if (!db) { next(); return; }
      db.prepare("SELECT id FROM users WHERE id = ?").get(decoded.id).then(function(user) {
        if (!user) return res.status(401).json({ error: "账号已被删除，请重新登录" });
        next();
      }).catch(function() { next(); });
    } catch(e) { next(); }
  } catch (err) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
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

async function departmentFilter(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'management') return next();
  req.userDeptIds = await getDepartmentTreeIds(req.user.department_id);
  next();
}

module.exports = { JWT_SECRET, generateToken, authMiddleware, requireRole, departmentFilter, getDepartmentTreeIds };