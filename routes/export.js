const express = require('express');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { getDb } = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createDownloadTicket } = require('../lib/download-ticket');
const STATUS_LABELS = require('../shared/status-labels.json');
const { getOverdueInfo } = require('../lib/overdue');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const EXPORT_JOB_DIR = path.join(__dirname, '..', 'uploads', 'export-jobs');
if (!fs.existsSync(EXPORT_JOB_DIR)) fs.mkdirSync(EXPORT_JOB_DIR, { recursive: true });
const IMG_MAX_W = 150;
const IMG_MAX_H = 100;
const exportJobs = new Map();
let exportJobSeq = 1;
const JOBS_FILE = path.join(EXPORT_JOB_DIR, 'jobs.json');

function saveExportJobs() {
  fs.writeFileSync(JOBS_FILE, JSON.stringify([...exportJobs.values()], null, 2));
}

async function processExportJob(job) {
  const db = getDb();
  const { status, ids } = job.payload || {};
  let orders;
  if (Array.isArray(ids) && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    orders = await db.prepare(`
      SELECT o.*, u.name as creator_name FROM orders o
      LEFT JOIN users u ON o.created_by = u.id WHERE o.id IN (${placeholders}) ORDER BY o.created_at DESC
    `).all(...ids);
  } else {
    let where = '';
    const params = [];
    if (status) { where = 'WHERE o.status = ?'; params.push(status); }
    orders = await db.prepare(`
      SELECT o.*, u.name as creator_name FROM orders o
      LEFT JOIN users u ON o.created_by = u.id ${where} ORDER BY o.created_at DESC
    `).all(...params);
  }

  try {
    const wb = await buildOrdersWorkbook(orders, '订单数据', job.downloadBase, job.userId);
    const buf = await wb.xlsx.writeBuffer();
    const filename = `export_${job.id}.xlsx`;
    fs.writeFileSync(path.join(EXPORT_JOB_DIR, filename), buf);
    job.status = 'done';
    job.filename = filename;
    job.error = null;
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
  }
  saveExportJobs();
}

function loadExportJobs() {
  if (!fs.existsSync(JOBS_FILE)) return;
  try {
    const jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    const maxId = jobs.reduce((max, job) => Math.max(max, Number(job.id) || 0), 0);
    if (maxId > 0) exportJobSeq = maxId + 1;
    for (const job of jobs) {
      exportJobs.set(job.id, job);
      if (job.status === 'pending') setImmediate(() => processExportJob(job));
    }
  } catch (e) {
    console.error('[Export] 恢复导出任务失败:', e.message);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of exportJobs) {
    if (now - job.createdAt > 60 * 60 * 1000) {
      if (job.filename) {
        try { fs.unlinkSync(path.join(EXPORT_JOB_DIR, job.filename)); } catch {}
      }
      exportJobs.delete(id);
    }
  }
  saveExportJobs();
}, 60 * 60 * 1000);

// === 辅助函数 ===

function ahex(hex) { return 'FF' + hex; }

function headerStyle(fillHex, fontHex) {
  return {
    font: { bold: true, color: { argb: ahex(fontHex) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ahex(fillHex) } },
    alignment: { horizontal: 'left' }
  };
}

function leftStyle() {
  return { alignment: { horizontal: 'left' } };
}

function overdueStyle(color) {
  if (!color) return {};
  return {
    font: { color: { argb: ahex(color.fg) } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ahex(color.bg) } },
    alignment: { horizontal: 'left' }
  };
}

function getStatusText(status) {
  return STATUS_LABELS[status] || status;
}

function getOverdueColor(stage) {
  const info = getOverdueInfo(stage);
  if (!info) return null;
  if (info.cssClass === 'overdue-red') {
    if (stage.status === 'completed') return { bg: 'f3f4f6', fg: '374151' };
    if (stage.status === 'in_progress' || stage.status === 'delayed') return { bg: 'fee2e2', fg: 'dc2626' };
    return null;
  }
  if (info.cssClass === 'overdue-green') return { bg: 'd1fae5', fg: '059669' };
  return null;
}

function getStatusLabel(color) {
  if (!color) return '-';
  if (color.bg === 'f3f4f6') return '超期';
  if (color.bg === 'd1fae5') return '如期';
  return '超期未完成';
}

function getOrderOverdueColor(order) {
  const info = getOverdueInfo(order);
  if (!info) return null;
  if (info.cssClass === 'overdue-red') return { bg: 'fee2e2', fg: 'dc2626' };
  if (info.cssClass === 'overdue-green') return { bg: 'd1fae5', fg: '059669' };
  return null;
}

async function getFilesInfo(orderId) {
  const db = getDb();
  return await db.prepare(`
    SELECT f.*, u.name as uploader_name
    FROM order_files f
    LEFT JOIN users u ON f.uploaded_by = u.id
    WHERE f.order_id = ?
    ORDER BY f.created_at DESC
  `).all(orderId);
}

function fmtSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getImageType(mime) {
  if (!mime) return null;
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpeg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
  return null;
}

function getImageDimensions(buf, mime) {
  try {
    if (mime.includes('png')) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (mime.includes('gif')) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (mime.includes('bmp')) return { w: buf.readUInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
    if (mime.includes('jpeg')) {
      let i = 2;
      while (i < buf.length - 1) {
        if (buf[i] !== 0xFF) break;
        const marker = buf[i + 1];
        if (marker === 0xC0 || marker === 0xC2) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch (e) { console.error('[Export] getImageDimensions 异常:', e.message); }
  return null;
}

function calcImageSize(origW, origH) {
  if (!origW || !origH) return { w: IMG_MAX_W, h: IMG_MAX_H };
  const ratio = Math.min(IMG_MAX_W / origW, IMG_MAX_H / origH);
  return { w: Math.round(origW * ratio), h: Math.round(origH * ratio) };
}

// 写入附件行（含图片嵌入）
// 返回: 用于后续行高设置的图片信息数组 [{row, height}]
function writeFileRows(ws, rowIdx, files, downloadBase, userId, workbook) {
  const imgRowHeights = [];
  if (files.length === 0) return { rowIdx, imgRowHeights };

  const fileHeader = ['附件名称', '文件类型', '文件大小', '上传人', '上传时间', '图片预览', '下载'];
  const hdrRow = ws.getRow(rowIdx);
  fileHeader.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: ahex('1e40af') } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ahex('dbeafe') } };
    cell.alignment = { horizontal: 'left' };
  });
  rowIdx++;

  for (const f of files) {
    const isImage = f.mime_type && f.mime_type.startsWith('image/');
    const row = ws.getRow(rowIdx);

    row.getCell(1).value = f.original_name;
    row.getCell(2).value = f.mime_type || '-';
    row.getCell(3).value = fmtSize(f.file_size);
    row.getCell(4).value = f.uploader_name || '未知';
    row.getCell(5).value = f.created_at || '';
    for (let i = 1; i <= 5; i++) row.getCell(i).alignment = { horizontal: 'left' };

    // 图片预览
    if (isImage && f.file_size < 2 * 1024 * 1024) { // 只嵌入 2MB 以下的图片
      const imgType = getImageType(f.mime_type);
      if (imgType) {
        const imgPath = path.join(UPLOAD_DIR, f.stored_name);
        try {
          if (fs.existsSync(imgPath)) {
            const buf = fs.readFileSync(imgPath);
            const dims = getImageDimensions(buf, f.mime_type);
            const size = calcImageSize(dims ? dims.w : null, dims ? dims.h : null);
            const imageId = workbook.addImage({ buffer: buf, extension: imgType });
            ws.addImage(imageId, {
              tl: { col: 5, row: rowIdx - 1 },
              ext: { width: size.w, height: size.h }
            });
            imgRowHeights.push({ row: rowIdx, height: Math.max(15, size.h * 0.75) });
          }
        } catch (e) {
          console.error('[Export] writeFileRows 图片嵌入异常:', e.message, '文件:', f.stored_name);
        }
      }
    }

    // 下载链接
    const dl = downloadBase + '/api/files/' + f.id + '/download?ticket=' + createDownloadTicket(f.id, userId);
    row.getCell(7).value = { text: '下载', hyperlink: dl };
    row.getCell(7).font = { underline: true, color: { argb: 'FF2563eb' } };
    row.getCell(7).alignment = { horizontal: 'left' };

    rowIdx++;
  }

  return { rowIdx, imgRowHeights };
}

// 对订单行/阶段行应用超期样式
function applyCellStyle(cell, color) {
  if (!color) return;
  cell.font = { color: { argb: ahex(color.fg) } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ahex(color.bg) } };
  cell.alignment = { horizontal: 'left' };
}

async function buildOrdersWorkbook(orders, sheetName, downloadBase, userId) {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  let rowIdx = 1;
  const headers = ['订单编号', '客户名称', '项目名称', '产品型号', '数量', '合同金额', '计划交货日期', '实际交货日期', '订单状态', '创建人', '创建时间'];
  const stageHeaders = ['阶段名称', '状态', '开始时间', '计划完成时间', '实际完成时间', '是否如期完成', '操作人'];

  const hdrRow = ws.getRow(rowIdx);
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h;
    Object.assign(cell, headerStyle('4ade80', '065f46'));
  });
  stageHeaders.forEach((h, i) => {
    const cell = hdrRow.getCell(headers.length + 1 + i);
    cell.value = h;
    Object.assign(cell, headerStyle('fbbf24', '92400e'));
  });
  rowIdx++;

  const orderIds = orders.map(o => o.id);
  const filesMap = new Map();
  const stagesMap = new Map();
  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    const fileRows = await db.prepare(`
      SELECT f.*, u.name as uploader_name FROM order_files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.order_id IN (${placeholders}) ORDER BY f.created_at DESC
    `).all(...orderIds);
    for (const file of fileRows) {
      if (!filesMap.has(file.order_id)) filesMap.set(file.order_id, []);
      filesMap.get(file.order_id).push(file);
    }
    const stageRows = await db.prepare(`
      SELECT * FROM process_stages WHERE order_id IN (${placeholders}) ORDER BY stage_order
    `).all(...orderIds);
    for (const stage of stageRows) {
      if (!stagesMap.has(stage.order_id)) stagesMap.set(stage.order_id, []);
      stagesMap.get(stage.order_id).push(stage);
    }
  }

  for (const order of orders) {
    const files = filesMap.get(order.id) || [];
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = order.order_no;
    row.getCell(2).value = order.customer_name;
    row.getCell(3).value = order.project_name;
    row.getCell(4).value = order.product_model || '';
    row.getCell(5).value = order.quantity;
    row.getCell(6).value = order.contract_amount || '';
    row.getCell(7).value = order.planned_delivery_date || '';
    row.getCell(8).value = order.actual_delivery_date || '';
    row.getCell(9).value = getStatusText(order.status);
    row.getCell(10).value = order.creator_name || '';
    row.getCell(11).value = order.created_at;
    for (let i = 1; i <= headers.length; i++) row.getCell(i).alignment = { horizontal: 'left' };
    if (files.length > 0) row.getCell(headers.length + 8).value = '附件: ' + files.length + ' 个';

    const orderColor = getOrderOverdueColor(order);
    if (orderColor) for (let i = 1; i <= headers.length; i++) applyCellStyle(row.getCell(i), orderColor);
    rowIdx++;

    const stages = stagesMap.get(order.id) || [];
    for (const s of stages) {
      const color = getOverdueColor(s);
      const base = headers.length + 1;
      const sRow = ws.getRow(rowIdx);
      sRow.getCell(base).value = s.stage_name;
      sRow.getCell(base + 1).value = getStatusText(s.status);
      sRow.getCell(base + 2).value = s.start_date || '';
      sRow.getCell(base + 3).value = s.planned_end_date || '';
      sRow.getCell(base + 4).value = s.actual_end_date || '';
      sRow.getCell(base + 5).value = getStatusLabel(color);
      sRow.getCell(base + 6).value = s.operator_name || '';
      for (let i = 0; i < 7; i++) {
        sRow.getCell(base + i).alignment = { horizontal: 'left' };
        if (color) applyCellStyle(sRow.getCell(base + i), color);
      }
      rowIdx++;
    }

    if (files.length > 0) {
      const result = writeFileRows(ws, rowIdx, files, downloadBase, userId, wb);
      rowIdx = result.rowIdx;
      result.imgRowHeights.forEach(h => { ws.getRow(h.row).height = h.height; });
      rowIdx++;
    }
  }

  for (let i = 1; i <= headers.length + 7; i++) ws.getColumn(i).width = 15;
  ws.getColumn(6).width = 22;
  return wb;
}

// === 批量导出（全部/按状态） ===
router.get('/orders', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const downloadBase = req.protocol + '://' + req.get('host');
  const db = getDb();
  const { status } = req.query;
  const validStatuses = ['pending', 'in_progress', 'completed', 'delayed'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: '不支持的订单状态' });
  }
  let where = '';
  const params = [];
  if (status) { where = 'WHERE o.status = ?'; params.push(status); }

  const orders = await db.prepare(`
    SELECT o.*, u.name as creator_name FROM orders o
    LEFT JOIN users u ON o.created_by = u.id ${where} ORDER BY o.created_at DESC
  `).all(...params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('订单数据');

  let rowIdx = 1;
  const headers = ['订单编号', '客户名称', '项目名称', '产品型号', '数量', '合同金额', '计划交货日期', '实际交货日期', '订单状态', '创建人', '创建时间'];
  const stageHeaders = ['阶段名称', '状态', '开始时间', '计划完成时间', '实际完成时间', '是否如期完成', '操作人'];

  const hdrRow = ws.getRow(rowIdx);
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h;
    Object.assign(cell, headerStyle('4ade80', '065f46'));
  });
  stageHeaders.forEach((h, i) => {
    const cell = hdrRow.getCell(headers.length + 1 + i);
    cell.value = h;
    Object.assign(cell, headerStyle('fbbf24', '92400e'));
  });
  rowIdx++;

  for (const order of orders) {
    const files = await getFilesInfo(order.id);
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = order.order_no;
    row.getCell(2).value = order.customer_name;
    row.getCell(3).value = order.project_name;
    row.getCell(4).value = order.product_model || '';
    row.getCell(5).value = order.quantity;
    row.getCell(6).value = order.contract_amount || '';
    row.getCell(7).value = order.planned_delivery_date || '';
    row.getCell(8).value = order.actual_delivery_date || '';
    row.getCell(9).value = getStatusText(order.status);
    row.getCell(10).value = order.creator_name || '';
    row.getCell(11).value = order.created_at;
    for (let i = 1; i <= headers.length; i++) row.getCell(i).alignment = { horizontal: 'left' };
    if (files.length > 0) row.getCell(headers.length + 8).value = '附件: ' + files.length + ' 个';

    const orderColor = getOrderOverdueColor(order);
    if (orderColor) for (let i = 1; i <= headers.length; i++) applyCellStyle(row.getCell(i), orderColor);
    rowIdx++;

    const stages = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? ORDER BY stage_order').all(order.id);
    for (const s of stages) {
      const color = getOverdueColor(s);
      const base = headers.length + 1;
      const sRow = ws.getRow(rowIdx);
      sRow.getCell(base).value = s.stage_name;
      sRow.getCell(base + 1).value = getStatusText(s.status);
      sRow.getCell(base + 2).value = s.start_date || '';
      sRow.getCell(base + 3).value = s.planned_end_date || '';
      sRow.getCell(base + 4).value = s.actual_end_date || '';
      sRow.getCell(base + 5).value = getStatusLabel(color);
      sRow.getCell(base + 6).value = s.operator_name || '';
      for (let i = 0; i < 7; i++) {
        sRow.getCell(base + i).alignment = { horizontal: 'left' };
        if (color) applyCellStyle(sRow.getCell(base + i), color);
      }
      rowIdx++;
    }

    if (files.length > 0) {
      const result = writeFileRows(ws, rowIdx, files, downloadBase, req.user.id, wb);
      rowIdx = result.rowIdx;
      result.imgRowHeights.forEach(h => { ws.getRow(h.row).height = h.height; });
      rowIdx++;
    }
  }

  for (let i = 1; i <= headers.length + 7; i++) ws.getColumn(i).width = 15;
  ws.getColumn(6).width = 22;

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
  res.send(buf);
});

// === 批量导出（按ID选择） ===
router.get('/orders/batch', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const downloadBase = req.protocol + '://' + req.get('host');
  const db = getDb();
  const ids = [].concat(req.query.ids || []).map(Number).filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: '请选择要导出的订单' });

  const placeholders = ids.map(() => '?').join(',');
  const orders = await db.prepare(`
    SELECT o.*, u.name as creator_name FROM orders o
    LEFT JOIN users u ON o.created_by = u.id WHERE o.id IN (${placeholders}) ORDER BY o.created_at DESC
  `).all(...ids);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('批量导出');

  let rowIdx = 1;
  const headers = ['订单编号', '客户名称', '项目名称', '产品型号', '数量', '合同金额', '计划交货日期', '实际交货日期', '订单状态', '创建人', '创建时间'];
  const stageHeaders = ['阶段名称', '状态', '开始时间', '计划完成时间', '实际完成时间', '是否如期完成', '操作人'];

  const hdrRow = ws.getRow(rowIdx);
  headers.forEach((h, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = h;
    Object.assign(cell, headerStyle('4ade80', '065f46'));
  });
  stageHeaders.forEach((h, i) => {
    const cell = hdrRow.getCell(headers.length + 1 + i);
    cell.value = h;
    Object.assign(cell, headerStyle('fbbf24', '92400e'));
  });
  rowIdx++;

  for (const order of orders) {
    const files = await getFilesInfo(order.id);
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = order.order_no;
    row.getCell(2).value = order.customer_name;
    row.getCell(3).value = order.project_name;
    row.getCell(4).value = order.product_model || '';
    row.getCell(5).value = order.quantity;
    row.getCell(6).value = order.contract_amount || '';
    row.getCell(7).value = order.planned_delivery_date || '';
    row.getCell(8).value = order.actual_delivery_date || '';
    row.getCell(9).value = getStatusText(order.status);
    row.getCell(10).value = order.creator_name || '';
    row.getCell(11).value = order.created_at;
    for (let i = 1; i <= headers.length; i++) row.getCell(i).alignment = { horizontal: 'left' };
    if (files.length > 0) row.getCell(headers.length + 8).value = '附件: ' + files.length + ' 个';

    const orderColor = getOrderOverdueColor(order);
    if (orderColor) for (let i = 1; i <= headers.length; i++) applyCellStyle(row.getCell(i), orderColor);
    rowIdx++;

    const stages = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? ORDER BY stage_order').all(order.id);
    for (const s of stages) {
      const color = getOverdueColor(s);
      const base = headers.length + 1;
      const sRow = ws.getRow(rowIdx);
      sRow.getCell(base).value = s.stage_name;
      sRow.getCell(base + 1).value = getStatusText(s.status);
      sRow.getCell(base + 2).value = s.start_date || '';
      sRow.getCell(base + 3).value = s.planned_end_date || '';
      sRow.getCell(base + 4).value = s.actual_end_date || '';
      sRow.getCell(base + 5).value = getStatusLabel(color);
      sRow.getCell(base + 6).value = s.operator_name || '';
      for (let i = 0; i < 7; i++) {
        sRow.getCell(base + i).alignment = { horizontal: 'left' };
        if (color) applyCellStyle(sRow.getCell(base + i), color);
      }
      rowIdx++;
    }

    if (files.length > 0) {
      const result = writeFileRows(ws, rowIdx, files, downloadBase, req.user.id, wb);
      rowIdx = result.rowIdx;
      result.imgRowHeights.forEach(h => { ws.getRow(h.row).height = h.height; });
      rowIdx++;
    }
  }

  for (let i = 1; i <= headers.length + 7; i++) ws.getColumn(i).width = 15;
  ws.getColumn(6).width = 22;

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=orders_batch_${new Date().toISOString().slice(0, 10)}.xlsx`);
  res.send(buf);
});

router.post('/jobs', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const db = getDb();
  const downloadBase = req.protocol + '://' + req.get('host');
  const { status, ids } = req.body || {};
  const validStatuses = ['pending', 'in_progress', 'completed', 'delayed'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: '不支持的订单状态' });
  }

  const jobId = String(exportJobSeq++);
  const job = {
    id: jobId,
    status: 'pending',
    error: null,
    filename: null,
    createdAt: Date.now(),
    userId: req.user.id,
    downloadBase,
    payload: { status: status || null, ids: Array.isArray(ids) ? ids : null }
  };
  exportJobs.set(jobId, job);
  saveExportJobs();
  setImmediate(() => processExportJob(job));

  res.status(202).json({ jobId });
});

router.get('/jobs/:id', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const job = exportJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: '导出任务不存在' });
  res.json({
    status: job.status,
    error: job.error || null,
    downloadUrl: job.status === 'done' ? `/api/export/jobs/${job.id}/download` : null
  });
});

router.get('/jobs/:id/download', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const job = exportJobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.filename) return res.status(404).json({ error: '导出文件不存在' });
  res.download(path.join(EXPORT_JOB_DIR, job.filename));
});

// === 单个订单导出 ===
router.get('/order/:id', authMiddleware, requireRole('admin', 'management'), async (req, res) => {
  const downloadBase = req.protocol + '://' + req.get('host');
  const db = getDb();
  const order = await db.prepare(`
    SELECT o.*, u.name as creator_name FROM orders o
    LEFT JOIN users u ON o.created_by = u.id WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });

  const stages = await db.prepare('SELECT * FROM process_stages WHERE order_id = ? ORDER BY stage_order').all(order.id);
  const files = await getFilesInfo(order.id);

  const wb = new ExcelJS.Workbook();

  // Sheet 1: 订单概要
  const ws1 = wb.addWorksheet('订单概要');
  const sumHdrs = ['订单编号', '客户名称', '项目名称', '产品型号', '数量', '合同金额', '计划交货日期', '实际交货日期', '订单状态', '创建人', '创建时间', '备注'];
  const hdr1 = ws1.getRow(1);
  sumHdrs.forEach((h, i) => {
    const cell = hdr1.getCell(i + 1);
    cell.value = h;
    Object.assign(cell, headerStyle('4ade80', '065f46'));
  });
  const row1 = ws1.getRow(2);
  row1.getCell(1).value = order.order_no;
  row1.getCell(2).value = order.customer_name;
  row1.getCell(3).value = order.project_name;
  row1.getCell(4).value = order.product_model || '';
  row1.getCell(5).value = order.quantity;
  row1.getCell(6).value = order.contract_amount || '';
  row1.getCell(7).value = order.planned_delivery_date || '';
  row1.getCell(8).value = order.actual_delivery_date || '';
  row1.getCell(9).value = getStatusText(order.status);
  row1.getCell(10).value = order.creator_name || '';
  row1.getCell(11).value = order.created_at;
  row1.getCell(12).value = order.notes || '';
  for (let i = 1; i <= sumHdrs.length; i++) row1.getCell(i).alignment = { horizontal: 'left' };
  const oc = getOrderOverdueColor(order);
  if (oc) for (let i = 1; i <= sumHdrs.length; i++) applyCellStyle(row1.getCell(i), oc);
  for (let i = 1; i <= sumHdrs.length; i++) ws1.getColumn(i).width = 18;

  // Sheet 2: 流程明细
  const ws2 = wb.addWorksheet('流程明细');
  const stgHdrs = ['阶段序号', '阶段名称', '状态', '开始时间', '计划完成时间', '实际完成时间', '是否如期完成', '操作人', '备注'];
  const hdr2 = ws2.getRow(1);
  stgHdrs.forEach((h, i) => {
    const cell = hdr2.getCell(i + 1);
    cell.value = h;
    Object.assign(cell, headerStyle('4ade80', '065f46'));
  });
  stages.forEach((s, idx) => {
    const r = idx + 2;
    const color = getOverdueColor(s);
    const row = ws2.getRow(r);
    row.getCell(1).value = s.stage_order;
    row.getCell(2).value = s.stage_name;
    row.getCell(3).value = getStatusText(s.status);
    row.getCell(4).value = s.start_date || '';
    row.getCell(5).value = s.planned_end_date || '';
    row.getCell(6).value = s.actual_end_date || '';
    row.getCell(7).value = getStatusLabel(color);
    row.getCell(8).value = s.operator_name || '';
    row.getCell(9).value = s.notes || '';
    for (let i = 1; i <= stgHdrs.length; i++) {
      row.getCell(i).alignment = { horizontal: 'left' };
      if (color) applyCellStyle(row.getCell(i), color);
    }
  });
  for (let i = 1; i <= stgHdrs.length; i++) ws2.getColumn(i).width = 15;

  // Sheet 3: 文件附件
  if (files.length > 0) {
    const ws3 = wb.addWorksheet('文件附件');
    const fileHeaders = ['附件名称', '文件类型', '文件大小', '上传人', '上传时间', '图片预览', '下载'];
    const hdr3 = ws3.getRow(1);
    fileHeaders.forEach((h, i) => {
      const cell = hdr3.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: ahex('1e40af') } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ahex('dbeafe') } };
      cell.alignment = { horizontal: 'left' };
    });

    files.forEach((f, idx) => {
      const r = idx + 2;
      const isImage = f.mime_type && f.mime_type.startsWith('image/');
      const row = ws3.getRow(r);
      row.getCell(1).value = f.original_name;
      row.getCell(2).value = f.mime_type || '-';
      row.getCell(3).value = fmtSize(f.file_size);
      row.getCell(4).value = f.uploader_name || '未知';
      row.getCell(5).value = f.created_at || '';
      for (let i = 1; i <= 5; i++) row.getCell(i).alignment = { horizontal: 'left' };

      if (isImage && f.file_size < 2 * 1024 * 1024) { // 只嵌入 2MB 以下的图片
        const imgType = getImageType(f.mime_type);
        if (imgType) {
          const imgPath = path.join(UPLOAD_DIR, f.stored_name);
          try {
            if (fs.existsSync(imgPath)) {
              const buf = fs.readFileSync(imgPath);
              const dims = getImageDimensions(buf, f.mime_type);
              const size = calcImageSize(dims ? dims.w : null, dims ? dims.h : null);
              const imageId = wb.addImage({ buffer: buf, extension: imgType });
              ws3.addImage(imageId, {
                tl: { col: 5, row: r - 1 },
                ext: { width: size.w, height: size.h }
              });
              ws3.getRow(r).height = Math.max(15, size.h * 0.75);
            }
          } catch (e) { console.error('[Export] 图片嵌入异常:', e.message, '文件:', f.stored_name); }
        }
      }

      const dl = downloadBase + '/api/files/' + f.id + '/download?ticket=' + createDownloadTicket(f.id, req.user.id);
      row.getCell(7).value = { text: '下载', hyperlink: dl };
      row.getCell(7).font = { underline: true, color: { argb: 'FF2563eb' } };
      row.getCell(7).alignment = { horizontal: 'left' };
    });

    for (let i = 1; i <= 7; i++) ws3.getColumn(i).width = 20;
    ws3.getColumn(6).width = 22;
  }

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=order_${order.order_no}.xlsx`);
  res.send(buf);
});

module.exports = { router, loadExportJobs };
