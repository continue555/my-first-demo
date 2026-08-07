const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { listNotifications, markRead, markAllRead, checkOverdue } = require('../services/notifications-service');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const r = await listNotifications(req.user, req.query);
  res.status(r.status).json(r.body);
});

router.put('/:id/read', authMiddleware, async (req, res) => {
  const r = await markRead(req.user, req.params.id);
  res.status(r.status).json(r.body);
});

router.put('/read-all', authMiddleware, async (req, res) => {
  const r = await markAllRead(req.user);
  res.status(r.status).json(r.body);
});

router.post('/check-overdue', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const r = await checkOverdue();
  res.status(r.status).json(r.body);
});

module.exports = router;
