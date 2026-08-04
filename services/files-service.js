const fs = require('fs');
const path = require('path');
const { getDb, logAudit } = require('../database');
const { createDownloadTicket } = require('../lib/download-ticket');
const { canDeleteFile } = require('../lib/file-permissions');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_ORDER_FILES_BYTES = 200 * 1024 * 1024; // 单订单附件总量上限 200MB

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function fixOriginalName(name) {
  if (!name || /^[\x00-\x7F]*$/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}

// 文件魔数验证：检查文件头是否匹配声明的 MIME 类型
const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png": [[0x89, 0x50, 0x4E, 0x47]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]],
  "image/bmp": [[0x42, 0x4D]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/msword": [[0x50, 0x4B, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4B, 0x03, 0x04]],
  "application/vnd.ms-excel": [[0x50, 0x4B, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4B, 0x03, 0x04]],
  "application/zip": [[0x50, 0x4B, 0x03, 0x04]],
  "application/x-rar-compressed": [[0x52, 0x61, 0x72, 0x21]],
  "text/plain": []
};

function validateMagicBytes(filePath, mimeType) {
  const magics = MAGIC_BYTES[mimeType];
  if (!magics || magics.length === 0) return true; // 没有定义魔数的类型跳过
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  for (const magic of magics) {
    const matches = magic.every((byte, i) => buf[i] === byte);
    if (matches) return true;
  }
  return false;
}

function exceedsOrderFileQuota(currentTotal, addedBytes) {
  return currentTotal + addedBytes > MAX_ORDER_FILES_BYTES;
}

async function listOrderFiles(orderId) {
  const db = getDb();
  const files = await db.prepare(`
    SELECT f.*, u.name as uploader_name
    FROM order_files f
    LEFT JOIN users u ON f.uploaded_by = u.id
    WHERE f.order_id = ?
    ORDER BY f.created_at DESC
  `).all(orderId);
  return { status: 200, body: { files } };
}

async function createPreviewTicket(fileId, userId) {
  const db = getDb();
  const file = await db.prepare('SELECT * FROM order_files WHERE id = ?').get(fileId);
  if (!file) {
    return { status: 404, body: { error: '文件不存在' } };
  }
  const ticket = createDownloadTicket(file.id, userId);
  return { status: 200, body: { url: `/api/files/${file.id}/preview?ticket=${ticket}` } };
}

async function saveUploadedFile({ orderId, user, file, stageKey }) {
  if (!validateMagicBytes(file.path, file.mimetype)) {
    fs.unlinkSync(file.path);
    return { status: 400, body: { error: '文件内容与类型不匹配，请检查文件' } };
  }

  const db = getDb();
  const totalRow = await db.prepare('SELECT COALESCE(SUM(file_size), 0) AS total FROM order_files WHERE order_id = ?').get(orderId);
  const currentTotal = Number(totalRow && totalRow.total) || 0;
  if (exceedsOrderFileQuota(currentTotal, file.size)) {
    fs.unlinkSync(file.path);
    return { status: 400, body: { error: '该订单附件总量已达上限（200MB），请先清理部分附件' } };
  }

  const originalName = fixOriginalName(file.originalname);

  try {
    await db.prepare(`
      INSERT INTO order_files (order_id, original_name, stored_name, mime_type, file_size, uploaded_by, stage_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, originalName, file.filename, file.mimetype, file.size, user.id, stageKey || null);
  } catch (e) {
    try { fs.unlinkSync(file.path); } catch {}
    throw e;
  }

  const order = await db.prepare('SELECT order_no FROM orders WHERE id = ?').get(orderId);
  await logAudit(user.id, user.name, '上传附件', 'order', parseInt(orderId), `订单: ${order?.order_no}, 文件: ${originalName}`);

  return { status: 201, body: { message: '文件上传成功', filename: originalName } };
}

async function resolveFile(fileId) {
  const db = getDb();
  const file = await db.prepare('SELECT * FROM order_files WHERE id = ?').get(fileId);
  if (!file) {
    return { status: 404, body: { error: '文件不存在' } };
  }

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) {
    return { status: 404, body: { error: '文件已丢失' } };
  }

  return { status: 200, file, filePath };
}

async function deleteFile(user, id) {
  const db = getDb();
  const file = await db.prepare('SELECT * FROM order_files WHERE id = ?').get(id);
  if (!file) {
    return { status: 404, body: { error: '文件不存在' } };
  }
  if (!canDeleteFile(user)) {
    return { status: 403, body: { error: '无权访问此文件' } };
  }

  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  await db.prepare('DELETE FROM order_files WHERE id = ?').run(id);

  const order = await db.prepare('SELECT order_no FROM orders WHERE id = ?').get(file.order_id);
  await logAudit(user.id, user.name, '删除附件', 'order', file.order_id, `订单: ${order?.order_no}, 文件: ${file.original_name}`);

  return { status: 200, body: { message: '文件已删除' } };
}

module.exports = {
  UPLOAD_DIR,
  MAX_ORDER_FILES_BYTES,
  exceedsOrderFileQuota,
  listOrderFiles,
  createPreviewTicket,
  saveUploadedFile,
  resolveFile,
  deleteFile
};
