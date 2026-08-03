const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb, logAudit } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const STAGE_DEFINITIONS = require('../shared/stage-defs.json');
const sanitize = require('../lib/sanitize');
const { canOperateStage } = require('../lib/stage-permissions');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const router = express.Router();

const ORDER_STATUSES = ['pending', 'in_progress', 'completed', 'delayed'];
const STAGE_STATUSES = ['pending', 'in_progress', 'completed'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  return sanitize(String(value).trim()).slice(0, max);
}

function validateDate(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
    return { ok: false, error: '日期格式不正确，应为 YYYY-MM-DD' };
  }
  return { ok: true, value };
}

const STAGE_DT_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function validateStageDateTime(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const str = String(value).slice(0, 16);
  if (!STAGE_DT_RE.test(str) || Number.isNaN(new Date(str).getTime())) {
    return { ok: false, error: '时间格式不正确' };
  }
  return { ok: true, value: str };
}

function validateOrderInput(body, create) {
  const data = {};
  const has = key => body[key] !== undefined;

  if (create || has('customer_name')) {
    const customer = cleanText(body.customer_name, 200);
    if (!customer) return { error: '客户名称为必填项' };
    data.customer_name = customer;
  }
  if (create || has('project_name')) {
    const project = cleanText(body.project_name, 200);
    if (!project) return { error: '项目名称为必填项' };
    data.project_name = project;
  }
  if (has('product_model')) {
    const product = body.product_model === null || body.product_model === undefined ? '' : cleanText(body.product_model, 200);
    data.product_model = product || null;
  }
  if (has('quantity')) {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
      return { error: '数量必须是 1-100000 的整数' };
    }
    data.quantity = quantity;
  }
  if (has('contract_amount')) {
    const amount = body.contract_amount === '' || body.contract_amount === null ? null : Number(body.contract_amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1000000000000)) {
      return { error: '合同金额必须是非负数' };
    }
    data.contract_amount = amount;
  }
  if (create || has('planned_delivery_date')) {
    const date = validateDate(body.planned_delivery_date);
    if (!date.ok) return { error: date.error };
    if (create && !date.value) return { error: '计划交货日期为必填项' };
    data.planned_delivery_date = date.value;
  }
  if (has('actual_delivery_date')) {
    const date = validateDate(body.actual_delivery_date);
    if (!date.ok) return { error: date.error };
    data.actual_delivery_date = date.value;
  }
  if (has('status')) {
    if (!ORDER_STATUSES.includes(body.status)) return { error: '不支持的订单状态' };
    data.status = body.status;
  }
  if (has('notes')) {
    data.notes = body.notes === null || body.notes === undefined ? null : cleanText(body.notes, 2000);
  }
  return { data };
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
    where += ' AND o.order_no LIKE ?';
    params.push(`%${search}%`);
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
    total: Number((await db.prepare('SELECT COUNT(*) as cnt FROM orders').get()).cnt),
    inProgress: Number((await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'in_progress'").get()).cnt),
    completed: Number((await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'completed'").get()).cnt),
    pending: Number((await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'").get()).cnt),
    overdue: Number((await db.prepare(`
      SELECT COUNT(*) as cnt FROM orders
      WHERE (
        status NOT IN ('completed', 'cancelled')
        AND planned_delivery_date IS NOT NULL
        AND planned_delivery_date::date < (NOW() AT TIME ZONE 'Asia/Shanghai')::date
      ) OR (
        status = 'completed'
        AND planned_delivery_date IS NOT NULL
        AND actual_delivery_date IS NOT NULL
        AND actual_delivery_date::date > planned_delivery_date::date
      )
    `).get()).cnt),
  };
  res.json({ stats });
});

// 创建订单
router.post('/', authMiddleware, requireRole('admin', 'management', 'sales'), async (req, res) => {
  const db = getDb();
  const validation = validateOrderInput(req.body, true);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const v = validation.data;

  const rawOrderNo = req.body.order_no === undefined || req.body.order_no === null ? '' : String(req.body.order_no);
  const customOrderNo = rawOrderNo.trim() ? cleanText(rawOrderNo, 50) : null;
  if (customOrderNo) {
    const exists = await db.prepare('SELECT id FROM orders WHERE order_no = ?').get(customOrderNo);
    if (exists) return res.status(400).json({ error: '订单编号已存在' });
  }
  const orderNo = customOrderNo || generateOrderNo();

  const result = await db.prepare(`
    INSERT INTO orders (order_no, customer_name, project_name, product_model, quantity, contract_amount, planned_delivery_date, status, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(orderNo, v.customer_name, v.project_name, v.product_model ?? null, v.quantity ?? 1, v.contract_amount ?? null, v.planned_delivery_date ?? null, v.notes ?? null, req.user.id);

  const orderId = result.lastInsertRowid;

  // 创建所有流程节点
  const insertStage = await db.prepare(`
    INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  await Promise.all(STAGE_DEFINITIONS.map(stage =>
    insertStage.run(orderId, stage.key, stage.name, stage.order, stage.parentKey, stage.deptId, stage.dependsOn)
  ));

  await logAudit(req.user.id, req.user.name, "创建订单", "order", orderId, `订单编号: ${orderNo}, 客户: ${v.customer_name}`);

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
router.put('/:id', authMiddleware, requireRole('admin', 'management', 'sales'), async (req, res) => {
  const db = getDb();
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  const validation = validateOrderInput(req.body, false);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const v = validation.data;

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
  `).run(v.customer_name ?? null, v.project_name ?? null, v.product_model ?? null, v.quantity ?? null, v.contract_amount ?? null, v.planned_delivery_date ?? null, v.actual_delivery_date ?? null, v.status ?? null, v.notes ?? null, req.params.id);

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
  const files = await db.prepare('SELECT stored_name FROM order_files WHERE order_id = ?').all(req.params.id);
  await db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  for (const file of files) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, file.stored_name)); } catch {}
  }
  await logAudit(req.user.id, req.user.name, "删除订单", "order", parseInt(req.params.id), `订单编号: ${orderNo}`);

  res.json({ message: '删除成功' });
});

// 更新流程节点状态
router.put('/:id/stages/:stageKey', authMiddleware, async (req, res) => {
  const db = getDb();
  const { id, stageKey } = req.params;
  const { status, notes } = req.body;
  if (!STAGE_STATUSES.includes(status)) {
    return res.status(400).json({ error: '不支持的流程状态' });
  }

  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }

  const stage = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? AND stage_key = ?').get(id, stageKey);
  if (!stage) {
    return res.status(404).json({ error: '流程节点不存在' });
  }

  // 权限校验：检查用户是否有权操作此节点
  if (req.user.role !== 'admin' && req.user.role !== 'management' && !(await canOperateStage(req.user, stage))) {
    return res.status(403).json({ error: stage.department_id ? '您没有权限操作此流程节点' : '该节点无负责部门，请联系管理员' });
  }

  const now = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);

  // 如果改为进行中，检查前置依赖
  if (status === 'in_progress') {
    if (stage.status === 'pending' && (!stage.start_date || !stage.planned_end_date)) {
      return res.status(400).json({ error: '请先设置开始时间和计划完成时间' });
    }
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
          INSERT INTO notifications (order_id, message, recipient_dept_id, source_key)
          VALUES (?, ?, ?, ?)
        `).run(id, `订单 ${order.order_no} 的"${stageDef.name}"已完成，请开始"${nextStage.name}"`, nextStage.deptId, `stage_completed:${id}:${stageKey}:${nextStage.key}`);
      }
    });
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
  const start = validateStageDateTime(start_date);
  const planned = validateStageDateTime(planned_end_date);
  if (!start.ok) return res.status(400).json({ error: start.error });
  if (!planned.ok) return res.status(400).json({ error: planned.error });
  if (start.value && planned.value && new Date(start.value) > new Date(planned.value)) {
    return res.status(400).json({ error: '开始时间不能晚于计划完成时间' });
  }

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
  `).run(start.value ?? null, planned.value ?? null, id, stageKey);

  res.json({ message: '时间更新成功' });
});

module.exports = { router, STAGE_DEFINITIONS };
