const express = require("express");
const { getDb } = require("../database");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", authMiddleware, requireRole("admin"), async (req, res) => {
  const db = getDb();
  const { page = 1, limit = 30, order_id } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = "WHERE 1=1";
  const params = [];
  if (order_id) { where += " AND target_id = ? AND target_type = ?"; params.push(parseInt(order_id), "order"); }
  const total = (await db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`).get(...params)).cnt;
  const logs = await db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
});

module.exports = router;
