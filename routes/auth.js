const express = require('express');
const { authMiddleware, requireRole, revokeSessionToken } = require('../middleware/auth');
const { parseCookies } = require('../lib/cookies');
const authService = require('../services/auth-service');

const router = express.Router();

function applyCookies(res, result) {
  if (!result.cookies) return;
  for (const cookie of result.cookies) {
    res.cookie(cookie.name, cookie.value, cookie.options);
  }
}

router.post('/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const result = await authService.login({
    username: req.body.username,
    password: req.body.password,
    ip,
    secure: req.secure
  });
  applyCookies(res, result);
  res.status(result.status).json(result.body);
});

router.post('/logout', async (req, res) => {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : parseCookies(req.headers.cookie).token;
  await revokeSessionToken(token);
  res.clearCookie('token', { path: '/' });
  res.clearCookie('csrf', { path: '/' });
  res.json({ message: '已退出登录' });
});

router.get('/me', authMiddleware, async (req, res) => {
  const result = await authService.me(req.user.id);
  res.status(result.status).json(result.body);
});

router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const result = await authService.listUsers();
  res.status(result.status).json(result.body);
});

router.put('/change-password', authMiddleware, async (req, res) => {
  const result = await authService.changePassword(req.user.id, req.body);
  res.status(result.status).json(result.body);
});

// === 用户管理（管理员） ===

router.post('/register', authMiddleware, requireRole('admin'), async (req, res) => {
  const result = await authService.register(req.user, req.body);
  res.status(result.status).json(result.body);
});

router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const result = await authService.deleteUser(req.user, req.params.id);
  res.status(result.status).json(result.body);
});

router.put('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const result = await authService.updateUser(req.user, req.params.id, req.body);
  res.status(result.status).json(result.body);
});

router.put('/users/:id/reset-password', authMiddleware, requireRole('admin'), async (req, res) => {
  const result = await authService.resetPassword(req.user, req.params.id, req.body);
  res.status(result.status).json(result.body);
});

module.exports = router;
