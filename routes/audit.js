const express = require("express");
const { getDb } = require("../database");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", authMiddleware, requireRole("admin"), async (req, res) => {
  const db = getDb();
  const { page = 1, limit = 30, order_id, order_no } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = "WHERE 1=1";
  const params = [];
  if (order_id) { where += " AND al.target_id = ? AND al.target_type = ?"; params.push(parseInt(order_id), "order"); }
  if (order_no) { where += " AND al.target_type IN ('order', 'order_stage') AND EXISTS (SELECT 1 FROM orders o WHERE o.order_no = ? AND o.id = al.target_id)"; params.push(order_no); }
  const total = (await db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs al ${where}`).get(...params)).cnt;
  const logs = await db.prepare(`SELECT al.* FROM audit_logs al ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
});

module.exports = router;
