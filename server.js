require('express-async-errors');
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./database');
const STALE_ASSET_ALIASES = require('./lib/stale-asset-map.json');
const { csrfProtection } = require('./middleware/csrf');
const exportRoutes = require('./routes/export');
const exportService = require('./services/export-service');
const ASSET_DIR = path.join(__dirname, 'public', 'assets');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

function findCurrentAsset(requestedName) {
  const ext = path.extname(requestedName);
  const prefix = requestedName.split('-')[0] + '-';
  if (prefix === 'index-' && ext === '.js') {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    const entry = html.match(/assets\/(index-[^"]+\.js)/)?.[1];
    if (entry && fs.existsSync(path.join(ASSET_DIR, entry))) return entry;
  }
  const files = fs.readdirSync(ASSET_DIR);
  return files.find(file => file.startsWith(prefix) && file.endsWith(ext)) || null;
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      reqId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - startedAt,
      userId: req.user ? req.user.id : null,
      username: req.user ? req.user.username : null
    }));
  });
  next();
});
app.use('/api', csrfProtection);
// 旧版 index.html 仍会引用上一次构建的 hash 文件名，这里把它们指向当前构建产物，
// 避免浏览器缓存旧 HTML 后因资源缺失而被 SPA 兜底成 text/html 导致白屏。
app.use('/assets/:file', (req, res, next) => {
  const requestedName = req.params.file;
  if (fs.existsSync(path.join(ASSET_DIR, requestedName))) return next();
  const target = STALE_ASSET_ALIASES[requestedName] || findCurrentAsset(requestedName);
  if (target) {
    const file = path.join(ASSET_DIR, path.basename(target));
    if (fs.existsSync(file)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(file);
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// API路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/orders', require('./routes/orders').router);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/export', exportRoutes.router);
app.use('/api/audit', require('./routes/audit'));
app.use('/api', require('./routes/orders-files'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// 缺失的静态资源返回 404，不能由 SPA 兜底成 HTML，否则浏览器会因 MIME 类型不符拒绝加载模块。
app.use('/assets', (req, res) => {
  res.status(404).type('text/plain').send('Asset not found');
});
app.use('/uploads', (req, res) => {
  res.status(404).type('text/plain').send('File not found');
});

// 前端路由 - SPA (禁用HTML缓存，确保每次获取最新版本)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理（放在所有路由之后，捕获未处理的异常）
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    reqId: req.id,
    method: req.method,
    path: req.originalUrl,
    userId: req.user ? req.user.id : null,
    message: err.message || String(err),
    stack: err.stack
  }));
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

// 异步初始化数据库后启动服务器
async function start() {
  await initDatabase();
  exportService.loadExportJobs();
  app.listen(PORT, () => {
    console.log(`服务器已启动: http://localhost:${PORT}`);
    console.log(`默认账号: admin / 123456`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
