const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const db = getDb();
  const departments = await db.prepare('SELECT * FROM departments ORDER BY id').all();
  res.json({ departments });
});

router.get('/tree', authMiddleware, async (req, res) => {
  const db = getDb();
  const all = await db.prepare('SELECT * FROM departments ORDER BY id').all();
  const tree = all.filter(d => !d.parent_id).map(parent => ({
    ...parent,
    children: all.filter(d => d.parent_id === parent.id)
  }));
  res.json({ tree });
});

module.exports = router;