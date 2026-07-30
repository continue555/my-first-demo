const express = require('express');
const { getDb, logAudit } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const STAGE_DEFINITIONS = require('../shared/stage-defs.json');

const router = express.Router();

function sanitize(str) {
  if (!str) return "";
  return String(str).replace(/[<>"']/g, '').slice(0, 200);
}

// 生成订单编号
function generateOrderNo() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${now.getFullYear()}-${dateStr.slice(4)}-${rand}`;
}

// 检查前置依赖是否满足
async function checkDependency(orderId, stageKey) {
  const db = getDb();
  const stage = STAGE_DEFINITIONS.find(s => s.key === stageKey);
  if (!stage || !stage.dependsOn) return { ok: true };

  // 支持逗号分隔的多依赖（如 "purchase_frame,purchase_mold_frame,..."）
  const depKeys = String(stage.dependsOn).split(',').map(k => k.trim());
  for (const depKey of depKeys) {
    const dep = await db.prepare(
      'SELECT status FROM process_stages WHERE order_id = ? AND stage_key = ?'
    ).get(orderId, depKey);

    if (!dep || dep.status !== 'completed') {
      const depStage = STAGE_DEFINITIONS.find(s => s.key === depKey);
      return { ok: false, message: `前置流程"${depStage ? depStage.name : depKey}"尚未完成，无法开始当前流程` };
    }
  }
  return { ok: true };
}

// 获取订单列表
router.get('/', authMiddleware, async (req, res) => {
  const db = getDb();
  const { search, status, startDate, endDate, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (o.order_no LIKE ? OR o.customer_name LIKE ? OR o.project_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where += ' AND o.status = ?';
    params.push(status);
  }
  if (startDate) {
    where += ' AND o.created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND o.created_at <= ?';
    params.push(endDate + ' 23:59:59');
  }

  const total = (await db.prepare(`SELECT COUNT(*) as cnt FROM orders o ${where}`).get(...params)).cnt;
  const orders = await db.prepare(`
    SELECT o.*, u.name as creator_name
    FROM orders o
    LEFT JOIN users u ON o.created_by = u.id
    ${where}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  // 获取每个订单的流程进度
  const ordersWithProgress = await Promise.all(orders.map(async (order) => {
    const stages = await db.prepare(
      'SELECT stage_key, status FROM process_stages WHERE order_id = ?'
    ).all(order.id);
    const completedCount = stages.filter(s => s.status === 'completed').length;
    const totalStages = STAGE_DEFINITIONS.length;
    order.progress = Math.round((completedCount / totalStages) * 100);
    return order;
  }));

  res.json({ orders: ordersWithProgress, total, page: parseInt(page), limit: parseInt(limit) });
});

// 获取统计信息
router.get('/stats', authMiddleware, async (req, res) => {
  const db = getDb();
  const stats = {
    total: (await db.prepare('SELECT COUNT(*) as cnt FROM orders').get()).cnt,
    inProgress: (await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'in_progress'").get()).cnt,
    completed: (await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'completed'").get()).cnt,
    delayed: (await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'delayed'").get()).cnt,
    pending: (await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'").get()).cnt,
    cancelled: (await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'cancelled'").get()).cnt,
  };
  res.json({ stats });
});

// 创建订单
router.post('/', authMiddleware, requireRole('admin', 'management', 'sales'), async (req, res) => {
  const db = getDb();
  const { customer_name, project_name, product_model, quantity, contract_amount, planned_delivery_date, notes } = req.body;
  if (!customer_name || !project_name) return res.status(400).json({ error: '客户名称和项目名称为必填项' });

  const cleanCustomer = sanitize(customer_name);
  const cleanProject = sanitize(project_name);
  const cleanProduct = sanitize(product_model);
  const cleanNotes = sanitize(notes);

  const orderNo = generateOrderNo();

  const result = await db.prepare(`
    INSERT INTO orders (order_no, customer_name, project_name, product_model, quantity, contract_amount, planned_delivery_date, status, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(orderNo, cleanCustomer, cleanProject, cleanProduct, quantity || 1, contract_amount ?? null, planned_delivery_date ?? null, cleanNotes, req.user.id);

  const orderId = result.lastInsertRowid;

  // 创建所有流程节点
  const insertStage = await db.prepare(`
    INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  STAGE_DEFINITIONS.forEach(async (stage) => {
    insertStage.run(orderId, stage.key, stage.name, stage.order, stage.parentKey, stage.deptId, stage.dependsOn);
  });
  await db.save();

  await logAudit(req.user.id, req.user.name, "创建订单", "order", orderId, `订单编号: ${orderNo}, 客户: ${customer_name}`);

  res.status(201).json({ message: '订单创建成功', orderId, orderNo });
});

// 获取订单详情
router.get('/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const order = await db.prepare(`
    SELECT o.*, u.name as creator_name
    FROM orders o
    LEFT JOIN users u ON o.created_by = u.id
    WHERE o.id = ?
  `).get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  const stages = await db.prepare(
    'SELECT * FROM process_stages WHERE order_id = ? ORDER BY stage_order'
  ).all(order.id);

  res.json({ order, stages });
});

// 更新订单
router.put('/:id', authMiddleware, async (req, res) => {
  const db = getDb();
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  const { customer_name, project_name, product_model, quantity, contract_amount, planned_delivery_date, actual_delivery_date, status, notes } = req.body;

  const cleanCustomer = customer_name ? sanitize(customer_name) : null;
  const cleanProject = project_name ? sanitize(project_name) : null;
  const cleanProduct = product_model ? sanitize(product_model) : null;
  const cleanNotes = notes !== undefined ? sanitize(notes) : null;

  await db.prepare(`
    UPDATE orders SET
      customer_name = COALESCE(?, customer_name),
      project_name = COALESCE(?, project_name),
      product_model = COALESCE(?, product_model),
      quantity = COALESCE(?, quantity),
      contract_amount = COALESCE(?, contract_amount),
      planned_delivery_date = COALESCE(?, planned_delivery_date),
      actual_delivery_date = COALESCE(?, actual_delivery_date),
      status = COALESCE(?, status),
      notes = COALESCE(?, notes),
      updated_at = datetime('now', '+8 hours')
    WHERE id = ?
  `).run(cleanCustomer, cleanProject, cleanProduct, quantity ?? null, contract_amount ?? null, planned_delivery_date ?? null, actual_delivery_date ?? null, status ?? null, cleanNotes ?? null, req.params.id);

  await logAudit(req.user.id, req.user.name, "编辑订单", "order", parseInt(req.params.id), `订单编号: ${order.order_no}`);

  res.json({ message: '更新成功' });
});

// 删除订单
router.delete('/:id', authMiddleware, requireRole('admin', 'management', 'sales'), async (req, res) => {
  const db = getDb();
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  const orderNo = order.order_no;
  await db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  await logAudit(req.user.id, req.user.name, "删除订单", "order", parseInt(req.params.id), `订单编号: ${orderNo}`);

  res.json({ message: '删除成功' });
});

// 更新流程节点状态
router.put('/:id/stages/:stageKey', authMiddleware, async (req, res) => {
  const db = getDb();
  const { id, stageKey } = req.params;
  const { status, notes } = req.body;

  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  const stage = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? AND stage_key = ?').get(id, stageKey);
  if (!stage) {
    return res.status(404).json({ error: '流程节点不存在' });
  }

  // 权限校验：检查用户是否有权操作此节点
  if (req.user.role !== 'admin' && req.user.role !== 'management') {
    const deptId = stage.department_id;
    if (!deptId) {
      return res.status(403).json({ error: '该节点无负责部门，请联系管理员' });
    }
    let authorized = false;
    if (req.user.role === 'sales' && deptId === 1) authorized = true;
    if (req.user.role === 'finance' && deptId === 3) authorized = true;
    if (req.user.role === 'production') {
      const childDeptIds = await require('../middleware/auth').getDepartmentTreeIds(req.user.department_id);
      authorized = deptId === req.user.department_id || childDeptIds.includes(deptId);
    }
    if (!authorized) {
      return res.status(403).json({ error: '您没有权限操作此流程节点' });
    }
  }

  const now = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);

  // 如果改为进行中，检查前置依赖
  if (status === 'in_progress') {
    const depCheck = await checkDependency(id, stageKey);
    if (!depCheck.ok) {
      return res.status(400).json({ error: depCheck.message });
    }

    await db.prepare(`
      UPDATE process_stages SET status = ?, start_date = COALESCE(start_date, ?), notes = COALESCE(?, notes), operator_id = ?, operator_name = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(status, now, notes ?? null, req.user.id, req.user.name, id, stageKey);

    // 更新订单状态为进行中
    if (order.status === 'pending' || order.status === 'delayed') {
      await db.prepare("UPDATE orders SET status = 'in_progress', updated_at = datetime('now', '+8 hours') WHERE id = ?").run(id);
    }
  }
  // 如果改为已完成
  else if (status === 'completed') {
    // 不允许从 pending 直接跳到 completed
    if (stage.status === 'pending') {
      return res.status(400).json({ error: '该流程节点尚未开始，无法直接完成' });
    }

    await db.prepare(`
      UPDATE process_stages SET status = ?, start_date = COALESCE(start_date, ?), actual_end_date = ?, notes = COALESCE(?, notes), operator_id = ?, operator_name = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(status, now, now, notes ?? null, req.user.id, req.user.name, id, stageKey);

    // 检查是否所有阶段都完成
    const allStages = await db.prepare('SELECT status FROM process_stages WHERE order_id = ?').all(id);
    const allDone = allStages.every(s => s.status === 'completed');
    if (allDone) {
      await db.prepare("UPDATE orders SET status = 'completed', actual_delivery_date = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?").run(now, id);
    }

    // 通知下一节点负责部门
    const stageDef = STAGE_DEFINITIONS.find(s => s.key === stageKey);
    const nextStages = STAGE_DEFINITIONS.filter(s => {
      if (!s.dependsOn) return false;
      return String(s.dependsOn).split(',').map(k => k.trim()).includes(stageKey);
    });
    nextStages.forEach(async (nextStage) => {
      if (nextStage.deptId) {
        await db.prepare(`
          INSERT INTO notifications (order_id, message, recipient_dept_id)
          VALUES (?, ?, ?)
        `).run(id, `订单 ${order.order_no} 的"${stageDef.name}"已完成，请开始"${nextStage.name}"`, nextStage.deptId);
      }
    });
  }
  // 延期
  else if (status === 'delayed') {
    await db.prepare(`
      UPDATE process_stages SET status = ?, notes = COALESCE(?, notes), operator_id = ?, operator_name = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(status, notes ?? null, req.user.id, req.user.name, id, stageKey);

    await db.prepare("UPDATE orders SET status = 'delayed', updated_at = datetime('now', '+8 hours') WHERE id = ?").run(id);
  }
  else {
    await db.prepare(`
      UPDATE process_stages SET status = ?, notes = COALESCE(?, notes), operator_id = ?, operator_name = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(status, notes ?? null, req.user.id, req.user.name, id, stageKey);
  }

  await logAudit(req.user.id, req.user.name, "更新阶段", "order_stage", parseInt(id), `订单: ${order.order_no}, 阶段: ${stage.stage_name}, 状态: ${status}`);

  res.json({ message: '流程状态更新成功' });
});

// 更新流程节点时间
router.put('/:id/stages/:stageKey/time', authMiddleware, async (req, res) => {
  const db = getDb();
  const { id, stageKey } = req.params;
  const { start_date, planned_end_date } = req.body;

  const stage = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? AND stage_key = ?').get(id, stageKey);
  if (!stage) {
    return res.status(404).json({ error: '流程节点不存在' });
  }

  // 如果时间已设置，仅管理员和总经理可修改
  if (stage.start_date && stage.planned_end_date && req.user.role !== 'admin' && req.user.role !== 'management') {
    return res.status(403).json({ error: '时间已设置，仅管理员和总经理可修改，请联系他们协助修改' });
  }

  await db.prepare(`
    UPDATE process_stages SET start_date = COALESCE(?, start_date), planned_end_date = COALESCE(?, planned_end_date), updated_at = datetime('now', '+8 hours')
    WHERE order_id = ? AND stage_key = ?
  `).run(start_date ?? null, planned_end_date ?? null, id, stageKey);

  res.json({ message: '时间更新成功' });
});

module.exports = { router, STAGE_DEFINITIONS };
