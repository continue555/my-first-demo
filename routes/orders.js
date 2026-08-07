const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const orderService = require('../services/order-service');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const r = await orderService.listOrders(req.query);
  res.status(r.status).json(r.body);
});

router.get('/stats', authMiddleware, requireRole('admin', 'management', 'sales', 'finance'), async (req, res) => {
  const r = await orderService.getStats();
  res.status(r.status).json(r.body);
});

router.post('/', authMiddleware, requireRole('admin', 'management', 'sales'), async (req, res) => {
  const r = await orderService.createOrder(req.user, req.body);
  res.status(r.status).json(r.body);
});

router.get('/:id', authMiddleware, async (req, res) => {
  const r = await orderService.getOrder(req.params.id);
  res.status(r.status).json(r.body);
});

router.delete('/:id', authMiddleware, requireRole('admin', 'management', 'sales'), async (req, res) => {
  const r = await orderService.deleteOrder(req.user, req.params.id);
  res.status(r.status).json(r.body);
});

router.put('/:id/stages/:stageKey', authMiddleware, async (req, res) => {
  const r = await orderService.updateStage(req.user, req.params.id, req.params.stageKey, req.body);
  res.status(r.status).json(r.body);
});

router.put('/:id/stages/:stageKey/time', authMiddleware, async (req, res) => {
  const r = await orderService.updateStageTime(req.user, req.params.id, req.params.stageKey, req.body);
  res.status(r.status).json(r.body);
});

module.exports = { router, STAGE_DEFINITIONS: orderService.STAGE_DEFINITIONS };
