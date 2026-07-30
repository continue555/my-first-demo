require('express-async-errors');
require('express-async-errors');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// API路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/orders', require('./routes/orders').router);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/export', require('./routes/export'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api', require('./routes/orders-files'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// 前端路由 - SPA (禁用HTML缓存，确保每次获取最新版本)
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理（放在所有路由之后，捕获未处理的异常）
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack || err.message || err);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

// 异步初始化数据库后启动服务器
async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`服务器已启动: http://localhost:${PORT}`);
    console.log(`默认账号: admin / 123456`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
