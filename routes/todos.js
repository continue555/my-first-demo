const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const todoService = require('../services/todo-service');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const result = await todoService.listMyTodos(req.user);
  res.status(result.status).json(result.body);
});

module.exports = router;
