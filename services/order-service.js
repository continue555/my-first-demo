const fs = require('fs');
const path = require('path');
const database = require('../database');
function getDb() { return database.getDb(); }
function logAudit(...args) { return database.logAudit(...args); }
const STAGE_DEFINITIONS = require('../shared/stage-defs.json');
const sanitize = require('../lib/sanitize');
const { canOperateStage } = require('../lib/stage-permissions');
const { buildCurrentStage } = require('../lib/current-stage');
const { buildScheduleSuggestions, STAGE_DURATIONS_DAYS, addDays } = require('../lib/stage-scheduler');
const { applyDeliverySchedule, recomputeDownstream, shiftDownstreamForActual } = require('../services/schedule-service');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const ORDER_STATUSES = ['pending', 'in_progress', 'completed'];
const STAGE_STATUSES = ['pending', 'in_progress', 'completed'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PURCHASE_STAGE_KEYS = ['purchase_frame', 'purchase_mold_frame', 'purchase_electrical', 'purchase_cover', 'mold_design_purchase'];
const FOLLOW_UP_STAGE_KEYS = ['frame_follow_up', 'mold_frame_follow_up', 'electrical_follow_up', 'cover_follow_up', 'mold_design_follow_up'];
const DELIVERY_PAYMENT_KEY = 'delivery_payment';
// 无开始时间概念的节点：采购跟进、物料进仓、提货款到账
const NO_START_STAGE_KEYS = new Set([...FOLLOW_UP_STAGE_KEYS, 'material_in', DELIVERY_PAYMENT_KEY]);
// 时间完全由联动自动生成的节点：采购跟进、物料进仓
const FULL_AUTO_STAGE_KEYS = new Set([...FOLLOW_UP_STAGE_KEYS, 'material_in']);
const PURCHASE_TO_FOLLOW_UP = {
  purchase_frame: 'frame_follow_up',
  purchase_mold_frame: 'mold_frame_follow_up',
  purchase_electrical: 'electrical_follow_up',
  purchase_cover: 'cover_follow_up',
  mold_design_purchase: 'mold_design_follow_up'
};
const FOLLOW_UP_TO_PURCHASE = Object.fromEntries(
  Object.entries(PURCHASE_TO_FOLLOW_UP).map(([purchase, followUp]) => [followUp, purchase])
);

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
    if (body.notes !== null && body.notes !== undefined && typeof body.notes !== 'string') {
      return { error: '备注格式不正确' };
    }
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

async function listOrders(query) {
  const db = getDb();
  const { search, status, startDate, endDate } = query;
  const rawPage = parseInt(query.page, 10);
  const rawLimit = parseInt(query.limit, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
  const offset = (page - 1) * limit;
  if (startDate && !DATE_RE.test(startDate)) return { status: 400, body: { error: '日期格式不正确，应为 YYYY-MM-DD' } };
  if (endDate && !DATE_RE.test(endDate)) return { status: 400, body: { error: '日期格式不正确，应为 YYYY-MM-DD' } };

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
      `SELECT ps.stage_key, ps.stage_name, ps.stage_order, ps.department_id, ps.status,
              ps.start_date, ps.planned_end_date, ps.actual_end_date, d.name AS dept_name
       FROM process_stages ps
       LEFT JOIN departments d ON ps.department_id = d.id
       WHERE ps.order_id = ?
       ORDER BY ps.stage_order`
    ).all(order.id);
    const completedCount = stages.filter(s => s.status === 'completed').length;
    const totalStages = STAGE_DEFINITIONS.length;
    order.progress = Math.round((completedCount / totalStages) * 100);
    order.current_stage = buildCurrentStage(stages);
    return order;
  }));

  return { status: 200, body: { orders: ordersWithProgress, total, page: parseInt(page), limit: parseInt(limit) } };
}

async function getStats() {
  const db = getDb();
  const stats = {
    total: Number((await db.prepare('SELECT COUNT(*) as cnt FROM orders').get()).cnt),
    inProgress: Number((await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'in_progress'").get()).cnt),
    completed: Number((await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'completed'").get()).cnt),
    pending: Number((await db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'").get()).cnt),
    overdue: Number((await db.prepare(`
      SELECT COUNT(*) as cnt FROM orders
      WHERE (
        status <> 'completed'
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
  return { status: 200, body: { stats } };
}

async function createOrder(user, body) {
  const db = getDb();
  const validation = validateOrderInput(body, true);
  if (validation.error) return { status: 400, body: { error: validation.error } };
  const v = validation.data;

  const rawOrderNo = body.order_no === undefined || body.order_no === null ? '' : String(body.order_no);
  const customOrderNo = rawOrderNo.trim() ? cleanText(rawOrderNo, 50) : null;
  if (customOrderNo) {
    const exists = await db.prepare('SELECT id FROM orders WHERE order_no = ?').get(customOrderNo);
    if (exists) return { status: 400, body: { error: '订单编号已存在' } };
  }
  const orderNo = customOrderNo || generateOrderNo();

  let result;
  try {
    result = await db.prepare(`
      INSERT INTO orders (order_no, customer_name, project_name, product_model, quantity, contract_amount, planned_delivery_date, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(orderNo, v.customer_name, v.project_name, v.product_model ?? null, v.quantity ?? 1, v.contract_amount ?? null, v.planned_delivery_date ?? null, v.notes ?? null, user.id);
  } catch (e) {
    if (e && e.code === '23505') {
      return { status: 400, body: { error: '订单编号已存在' } };
    }
    throw e;
  }

  const orderId = result.lastInsertRowid;

  // 创建所有流程节点
  const suggestions = v.planned_delivery_date ? buildScheduleSuggestions(STAGE_DEFINITIONS, v.planned_delivery_date) : {};
  const insertStage = await db.prepare(`
    INSERT INTO process_stages (order_id, stage_key, stage_name, stage_order, parent_stage_key, department_id, depends_on, start_date, planned_end_date, planned_end_source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  await Promise.all(STAGE_DEFINITIONS.map(stage =>
    insertStage.run(
      orderId, stage.key, stage.name, stage.order, stage.parentKey, stage.deptId, stage.dependsOn,
      suggestions[stage.key]?.start_date ?? null,
      suggestions[stage.key]?.planned_end_date ?? null,
      'auto'
    )
  ));

  await logAudit(user.id, user.name, "创建订单", "order", orderId, `订单编号: ${orderNo}, 客户: ${v.customer_name}`);

  return { status: 201, body: { message: '订单创建成功', orderId, orderNo } };
}

async function getOrder(id) {
  const db = getDb();
  const order = await db.prepare(`
    SELECT o.*, u.name as creator_name
    FROM orders o
    LEFT JOIN users u ON o.created_by = u.id
    WHERE o.id = ?
  `).get(id);

  if (!order) {
    return { status: 404, body: { error: '订单不存在' } };
  }

  const stages = await db.prepare(
    'SELECT * FROM process_stages WHERE order_id = ? ORDER BY stage_order'
  ).all(order.id);

  return { status: 200, body: { order, stages } };
}

async function updateOrder(user, id, body) {
  const db = getDb();
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) {
    return { status: 404, body: { error: '订单不存在' } };
  }

  const validation = validateOrderInput(body, false);
  if (validation.error) return { status: 400, body: { error: validation.error } };
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
  `).run(v.customer_name ?? null, v.project_name ?? null, v.product_model ?? null, v.quantity ?? null, v.contract_amount ?? null, v.planned_delivery_date ?? null, v.actual_delivery_date ?? null, v.status ?? null, v.notes ?? null, id);

  const deliveryChanged = v.planned_delivery_date && v.planned_delivery_date !== order.planned_delivery_date;
  const explicitRecompute = body.recompute_dates === true;
  let scheduleNote = '';
  if ((deliveryChanged || explicitRecompute) && (v.planned_delivery_date || order.planned_delivery_date)) {
    const { written } = await applyDeliverySchedule(
      db,
      id,
      v.planned_delivery_date || order.planned_delivery_date,
      explicitRecompute
    );
    scheduleNote = `，倒排计划建议更新 ${written} 个节点`;
  }

  await logAudit(user.id, user.name, "编辑订单", "order", parseInt(id), `订单编号: ${order.order_no}${scheduleNote}`);

  return { status: 200, body: { message: '更新成功' } };
}

async function deleteOrder(user, id) {
  const db = getDb();
  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) {
    return { status: 404, body: { error: '订单不存在' } };
  }

  const orderNo = order.order_no;
  const files = await db.prepare('SELECT stored_name FROM order_files WHERE order_id = ?').all(id);
  await db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  for (const file of files) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, file.stored_name)); } catch {}
  }
  await logAudit(user.id, user.name, "删除订单", "order", parseInt(id), `订单编号: ${orderNo}`);

  return { status: 200, body: { message: '删除成功' } };
}

async function updateStage(user, id, stageKey, body) {
  const db = getDb();
  const { status, notes } = body;
  const stageCheck = validateStageUpdate(body);
  if (stageCheck) return { status: 400, body: { error: stageCheck.error } };

  const order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) {
    return { status: 404, body: { error: '订单不存在' } };
  }

  const stage = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? AND stage_key = ?').get(id, stageKey);
  if (!stage) {
    return { status: 404, body: { error: '流程节点不存在' } };
  }

  if (stage.status === 'completed' && status !== 'completed') {
    return { status: 400, body: { error: '该流程节点已完成，不能回退状态' } };
  }

  // 权限校验：检查用户是否有权操作此节点
  if (user.role !== 'admin' && user.role !== 'management' && !(await canOperateStage(user, stage))) {
    return { status: 403, body: { error: stage.department_id ? '您没有权限操作此流程节点' : '该节点无负责部门，请联系管理员' } };
  }

  const now = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const autoStage = NO_START_STAGE_KEYS.has(stageKey);

  // 如果改为进行中，检查前置依赖
  if (status === 'in_progress') {
    if (stage.status === 'pending' && (!stage.planned_end_date || (!autoStage && !stage.start_date))) {
      const error = stageKey === DELIVERY_PAYMENT_KEY
        ? '请先设置计划完成日期'
        : autoStage
          ? '计划完成时间未生成，请先确认采购计划到货时间'
          : '请先设置开始时间和计划完成时间';
      return {
        status: 400,
        body: { error }
      };
    }
    const depCheck = await checkDependency(id, stageKey);
    if (!depCheck.ok) {
      return { status: 400, body: { error: depCheck.message } };
    }

    await db.prepare(`
      UPDATE process_stages SET status = ?, start_date = ?, notes = COALESCE(?, notes), operator_id = ?, operator_name = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(status, autoStage ? null : now, notes ?? null, user.id, user.name, id, stageKey);

    // 实际开始晚于计划时，自动顺延下游未开始节点
    if (!autoStage && stage.planned_end_date) {
      const duration = STAGE_DURATIONS_DAYS[stageKey] || 0;
      const plannedStart = duration > 0 ? addDays(stage.planned_end_date, -duration) : null;
      if (plannedStart) {
        await shiftDownstreamForActual(db, id, stageKey, now, plannedStart, {
          type: 'start',
          stageName: stage.stage_name
        });
      }
    }

    // 更新订单状态为进行中
    if (order.status === 'pending') {
      await db.prepare("UPDATE orders SET status = 'in_progress', updated_at = datetime('now', '+8 hours') WHERE id = ?").run(id);
    }
  }
  // 如果改为已完成
  else if (status === 'completed') {
    if (stage.status === 'completed') {
      return { status: 400, body: { error: '该流程节点已完成，不能重复完成' } };
    }
    // 不允许从 pending 直接跳到 completed
    if (stage.status === 'pending') {
      return { status: 400, body: { error: '该流程节点尚未开始，无法直接完成' } };
    }

    // 采购节点的实际到货时间由采购跟进/物料进仓确认后回填，完成时不写入
    const actualEnd = PURCHASE_STAGE_KEYS.includes(stageKey) ? null : now;
    await db.prepare(`
      UPDATE process_stages SET status = ?, start_date = COALESCE(start_date, ?), actual_end_date = ?, notes = COALESCE(?, notes), operator_id = ?, operator_name = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(status, autoStage ? null : now, actualEnd, notes ?? null, user.id, user.name, id, stageKey);

    // 采购完成时，同步对应采购跟进的计划到货时间（跟进无开始时间概念）
    if (PURCHASE_TO_FOLLOW_UP[stageKey]) {
      await db.prepare(`
        UPDATE process_stages SET planned_end_date = COALESCE(planned_end_date, ?), updated_at = datetime('now', '+8 hours')
        WHERE order_id = ? AND stage_key = ?
      `).run(stage.planned_end_date, id, PURCHASE_TO_FOLLOW_UP[stageKey]);
    }

    // 采购跟进确认到货后，回填对应采购的实际到货时间（取更晚值）
    if (FOLLOW_UP_TO_PURCHASE[stageKey]) {
      await db.prepare(`
        UPDATE process_stages SET actual_end_date = ?, updated_at = datetime('now', '+8 hours')
        WHERE order_id = ? AND stage_key = ? AND (actual_end_date IS NULL OR actual_end_date < ?)
      `).run(now, id, FOLLOW_UP_TO_PURCHASE[stageKey], now);
    }

    // 物料进仓确认到货后，统一回填所有采购的实际到货时间（取最晚值）
    if (stageKey === 'material_in') {
      const placeholders = PURCHASE_STAGE_KEYS.map(() => '?').join(',');
      await db.prepare(`
        UPDATE process_stages SET actual_end_date = GREATEST(COALESCE(actual_end_date, ''), ?), updated_at = datetime('now', '+8 hours')
        WHERE order_id = ? AND stage_key IN (${placeholders})
      `).run(now, id, ...PURCHASE_STAGE_KEYS);
    }

    // 发货完成时回填实际交货日期
    if (stageKey === 'shipping') {
      await db.prepare(`
        UPDATE orders SET actual_delivery_date = COALESCE(actual_delivery_date, ?), updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `).run(now.slice(0, 10), id);
    }

    // 实际完成晚于/早于计划时，自动顺延或提前下游未开始节点（采购节点实际到货由下游回填，跳过）
    if (actualEnd) {
      await shiftDownstreamForActual(db, id, stageKey, actualEnd, stage.planned_end_date, {
        type: 'completion',
        stageName: stage.stage_name
      });
    }

    // 检查是否所有阶段都完成
    const allStages = await db.prepare('SELECT status FROM process_stages WHERE order_id = ?').all(id);
    const allDone = allStages.every(s => s.status === 'completed');
    if (allDone) {
      await db.prepare("UPDATE orders SET status = 'completed', actual_delivery_date = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?").run(now, id);
    }

    // 通知下一节点（依赖全部满足后才通知，并按接收方聚合）
    const stageDef = STAGE_DEFINITIONS.find(s => s.key === stageKey);
    await notifyReadyNextStages(db, order, id, stageKey, stageDef);
  }
  else {
    await db.prepare(`
      UPDATE process_stages SET status = ?, notes = COALESCE(?, notes), operator_id = ?, operator_name = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(status, notes ?? null, user.id, user.name, id, stageKey);
  }

  await logAudit(user.id, user.name, "更新阶段", "order_stage", parseInt(id), `订单: ${order.order_no}, 阶段: ${stage.stage_name}, 状态: ${status}`);

  return { status: 200, body: { message: '流程状态更新成功' } };
}

async function updateStageTime(user, id, stageKey, body) {
  const db = getDb();
  const { start_date, planned_end_date } = body;
  const start = validateStageDateTime(start_date);
  const planned = validateStageDateTime(planned_end_date);
  if (!start.ok) return { status: 400, body: { error: start.error } };
  if (!planned.ok) return { status: 400, body: { error: planned.error } };
  const autoTimeStage = FULL_AUTO_STAGE_KEYS.has(stageKey);
  if (autoTimeStage && (start.value || planned.value)) {
    return {
      status: 400,
      body: {
        error: stageKey === 'material_in'
          ? '物料进仓时间由各采购计划到货自动生成，不能手动修改'
          : '采购跟进时间由对应采购计划到货自动生成，不能手动修改'
      }
    };
  }
  if (stageKey === DELIVERY_PAYMENT_KEY && start.value) {
    return { status: 400, body: { error: '提货款到账不需要开始时间，请仅设置计划完成日期' } };
  }
  if (start.value && planned.value && new Date(start.value) > new Date(planned.value)) {
    return { status: 400, body: { error: '开始时间不能晚于计划完成时间' } };
  }

  const stage = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? AND stage_key = ?').get(id, stageKey);
  if (!stage) {
    return { status: 404, body: { error: '流程节点不存在' } };
  }

  // 如果时间已设置，仅管理员和总经理可修改
  if (user.role !== 'admin' && user.role !== 'management' && !(await canOperateStage(user, stage))) {
    return { status: 403, body: { error: stage.department_id ? '您没有权限操作此流程节点' : '该节点无负责部门，请联系管理员' } };
  }
  const timeAlreadySet = NO_START_STAGE_KEYS.has(stageKey)
    ? !!stage.planned_end_date
    : !!stage.start_date && !!stage.planned_end_date;
  if (timeAlreadySet && user.role !== 'admin' && user.role !== 'management') {
    return { status: 403, body: { error: '时间已设置，仅管理员和总经理可修改，请联系他们协助修改' } };
  }

  await db.prepare(`
    UPDATE process_stages SET start_date = COALESCE(?, start_date), planned_end_date = COALESCE(?, planned_end_date), planned_end_source = 'manual', updated_at = datetime('now', '+8 hours')
    WHERE order_id = ? AND stage_key = ?
  `).run(start.value ?? null, planned.value ?? null, id, stageKey);

  // 采购计划到货时间变化时，自动同步采购跟进计划完成时间，并重算物料进仓计划完成时间
  if (PURCHASE_TO_FOLLOW_UP[stageKey] && planned.value) {
    await db.prepare(`
      UPDATE process_stages SET planned_end_date = ?, updated_at = datetime('now', '+8 hours')
      WHERE order_id = ? AND stage_key = ?
    `).run(planned.value, id, PURCHASE_TO_FOLLOW_UP[stageKey]);
    await syncMaterialInPlanned(db, id);
  }

  let warnings = [];
  if (planned.value) {
    warnings = await recomputeDownstream(db, id, stageKey, planned.value);
    await logAudit(user.id, user.name, '设置时间', 'order_stage', parseInt(id), `阶段: ${stage.stage_name}, 计划完成日期: ${planned.value}`);
  }

  return {
    status: 200,
    body: {
      message: '时间更新成功',
      ...(warnings.length > 0 ? { warnings } : {})
    }
  };
}

async function syncMaterialInPlanned(db, orderId) {
  const placeholders = PURCHASE_STAGE_KEYS.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT planned_end_date FROM process_stages WHERE order_id = ? AND stage_key IN (${placeholders})
  `).all(orderId, ...PURCHASE_STAGE_KEYS);
  const dates = rows.map(r => r.planned_end_date).filter(Boolean);
  const maxDate = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  await db.prepare(`
    UPDATE process_stages SET planned_end_date = ?, updated_at = datetime('now', '+8 hours')
    WHERE order_id = ? AND stage_key = 'material_in'
  `).run(maxDate, orderId);
}

async function notifyReadyNextStages(db, order, id, stageKey, stageDef) {
  const nextStages = STAGE_DEFINITIONS.filter(s => {
    if (!s.dependsOn) return false;
    return String(s.dependsOn).split(',').map(k => k.trim()).includes(stageKey);
  });

  const ready = [];
  for (const nextStage of nextStages) {
    const depKeys = String(nextStage.dependsOn).split(',').map(k => k.trim());
    if (depKeys.length > 1) {
      const placeholders = depKeys.map(() => '?').join(',');
      const deps = await db.prepare(
        `SELECT status FROM process_stages WHERE order_id = ? AND stage_key IN (${placeholders})`
      ).all(id, ...depKeys);
      if (!deps.every(d => d.status === 'completed')) continue;
    }
    ready.push(nextStage);
  }
  if (ready.length === 0) return;

  const byRecipient = new Map();
  for (const s of ready) {
    const recKey = s.deptId ? `dept:${s.deptId}` : 'role:management';
    if (!byRecipient.has(recKey)) {
      byRecipient.set(recKey, { deptId: s.deptId || null, role: s.deptId ? null : 'management', names: [] });
    }
    byRecipient.get(recKey).names.push(s.name);
  }

  for (const [recKey, rec] of byRecipient) {
    const message = `订单 ${order.order_no} 的"${stageDef.name}"已完成，请开始：${rec.names.join('、')}`;
    try {
      if (rec.deptId) {
        await db.prepare(`
          INSERT INTO notifications (order_id, message, recipient_dept_id, source_key)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
        `).run(id, message, rec.deptId, `stage_completed:${id}:${stageKey}:${recKey}`);
      } else {
        await db.prepare(`
          INSERT INTO notifications (order_id, message, recipient_role, source_key)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
        `).run(id, message, rec.role, `stage_completed:${id}:${stageKey}:${recKey}`);
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        message: '阶段完成通知写入失败',
        orderId: id,
        stageKey,
        nextStage: rec.names.join('、'),
        error: e.message
      }));
    }
  }
}

function validateStageUpdate(body) {
  const { status, notes } = body || {};
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return { error: '备注格式不正确' };
  }
  if (!STAGE_STATUSES.includes(status)) {
    return { error: '不支持的流程状态' };
  }
  return null;
}

module.exports = {
  listOrders, getStats, createOrder, getOrder, updateOrder, deleteOrder, updateStage, updateStageTime,
  validateStageUpdate, cleanText, validateDate, validateStageDateTime, validateOrderInput, generateOrderNo,
  STAGE_DEFINITIONS
};
