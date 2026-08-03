const express = require("express");
const { getDb } = require("../database");
const { authMiddleware, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", authMiddleware, requireRole("admin"), async (req, res) => {
  const db = getDb();
  const { page, limit, order_id, order_no } = req.query;
  const rawPage = parseInt(page, 10);
  const rawLimit = parseInt(limit, 10);
  const safePage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30;
  const offset = (safePage - 1) * safeLimit;
  if (order_id && (!/^\d+$/.test(String(order_id)) || Number(order_id) < 1)) {
    return res.status(400).json({ error: "订单ID格式不正确" });
  }
  let where = "WHERE 1=1";
  const params = [];
  if (order_id) { where += " AND al.target_id = ? AND al.target_type = ?"; params.push(parseInt(order_id), "order"); }
  if (order_no) { where += " AND al.target_type IN ('order', 'order_stage') AND EXISTS (SELECT 1 FROM orders o WHERE o.order_no = ? AND o.id = al.target_id)"; params.push(order_no); }
  const total = (await db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs al ${where}`).get(...params)).cnt;
  const logs = await db.prepare(`SELECT al.* FROM audit_logs al ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);
  res.json({ logs, total, page: safePage, limit: safeLimit });
});

module.exports = router;
