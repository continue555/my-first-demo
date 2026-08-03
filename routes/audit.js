const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { listAudit } = require('../services/audit-service');

const router = express.Router();

router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const r = await listAudit(req.query);
  res.status(r.status).json(r.body);
});

module.exports = router;
